import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDuration } from "./config/schema.js";
import { loadConfigFile, resolveServerConfig, buildInlineServerConfig } from "./config/loader.js";
import { StdioProxy } from "./proxy/stdio-proxy.js";
import { composeMiddleware } from "./middleware/chain.js";
import { createTimeoutMiddleware } from "./middleware/timeout.js";
import { createRetryMiddleware } from "./middleware/retry.js";
import { createCircuitBreakerMiddleware } from "./middleware/circuit-breaker.js";
import { createLoggerMiddleware, createLogger, createCircuitBreakerLogger } from "./middleware/logger.js";

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    ) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("mcp-shield")
  .description("Production-grade resilience middleware for MCP servers")
  .version(getVersion());

program
  .command("wrap")
  .description("Wrap an MCP server with resilience middleware")
  .option("-c, --config <path>", "Path to YAML config file")
  .option("-s, --server <name>", "Server name from config file")
  .option("-t, --timeout <duration>", "Timeout per tool call (e.g. 30s, 1m)")
  .option("-r, --retries <count>", "Max retry attempts", parseInt)
  .option("--log-level <level>", "Logging level (debug|info|warn|error)")
  .option("--log-format <format>", "Log format (json|pretty)")
  .allowUnknownOption(false)
  .action(async (opts: {
    config?: string;
    server?: string;
    timeout?: string;
    retries?: number;
    logLevel?: string;
    logFormat?: string;
  }, cmd: Command) => {
    try {
      // Get the command after "--"
      const extraArgs = cmd.args;

      let serverConfig;

      if (opts.config) {
        // Config file mode
        const configPath = resolve(opts.config);
        const config = loadConfigFile(configPath);

        if (opts.server) {
          serverConfig = resolveServerConfig(config, opts.server);
        } else {
          // Use first server if only one exists
          const serverNames = Object.keys(config.servers);
          if (serverNames.length === 0) {
            logError("No servers defined in config file.");
            process.exit(1);
          }
          if (serverNames.length > 1 && !opts.server) {
            logError(
              `Multiple servers in config. Use --server to specify one: ${serverNames.join(", ")}`,
            );
            process.exit(1);
          }
          serverConfig = resolveServerConfig(config, serverNames[0]!);
        }
      } else if (extraArgs.length > 0) {
        // Inline mode
        const timeout = opts.timeout ? parseDuration(opts.timeout) : undefined;

        serverConfig = buildInlineServerConfig({
          command: extraArgs[0]!,
          args: extraArgs.slice(1),
          timeout,
          retries: opts.retries,
          logLevel: opts.logLevel,
          logFormat: opts.logFormat,
        });
      } else {
        logError(
          "No server command provided. Usage:\n" +
          "  mcp-shield wrap -- npx @modelcontextprotocol/server-github\n" +
          "  mcp-shield wrap --config mcp-shield.yaml --server github",
        );
        process.exit(1);
      }

      // Create logger
      const logger = createLogger(serverConfig.logging);
      const cbEvents = createCircuitBreakerLogger(logger);

      // Build middleware chain: logger → timeout → retry → circuit breaker
      const middleware = composeMiddleware([
        createLoggerMiddleware(logger),
        createTimeoutMiddleware(),
        createRetryMiddleware(),
        createCircuitBreakerMiddleware(cbEvents),
      ]);

      const serverName = opts.server ?? "default";

      // Create and start proxy
      const proxy = new StdioProxy({
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
        serverName,
        middleware,
        resolveToolConfig: serverConfig.resolveToolConfig,
      });

      proxy.on("error", (err: Error) => {
        logger.error({ msg: "proxy_error", error: err.message });
      });

      proxy.on("exit", (code: number | null, signal: string | null) => {
        logger.info({ msg: "server_exit", code, signal });
        process.exit(code ?? 1);
      });

      logger.info({
        msg: "proxy_start",
        server: serverName,
        command: serverConfig.command,
      });

      proxy.start();
    } catch (err) {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

function logError(msg: string): void {
  process.stderr.write(`mcp-shield: error: ${msg}\n`);
}

program.parse();
