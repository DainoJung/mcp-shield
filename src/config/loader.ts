import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { configSchema, type RawConfig, type RawServerConfig } from "./schema.js";
import { BUILT_IN_DEFAULTS, mergeConfigs, type ResolvedToolConfig } from "./defaults.js";

/**
 * Interpolate ${ENV_VAR} references in a string with process.env values.
 */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)}/g, (_, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(
        `Environment variable '${varName}' is not set. Set it or remove the reference from config.`,
      );
    }
    return envValue;
  });
}

function interpolateEnvInObject(obj: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = interpolateEnv(value);
  }
  return result;
}

export interface LoadedServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  resolveToolConfig: (toolName: string) => ResolvedToolConfig;
  logging: { level: string; format: "json" | "pretty" };
}

/**
 * Load and validate a YAML config file.
 */
export function loadConfigFile(filePath: string): RawConfig {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read config file '${filePath}': ${msg}`);
  }

  const raw = parseYaml(content) as unknown;
  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config file '${filePath}':\n${issues}`);
  }

  return result.data;
}

/**
 * Resolve a server config from a loaded YAML config.
 */
export function resolveServerConfig(
  config: RawConfig,
  serverName: string,
): LoadedServerConfig {
  const serverConfig = config.servers[serverName];
  if (!serverConfig) {
    const available = Object.keys(config.servers).join(", ");
    throw new Error(
      `Server '${serverName}' not found in config. Available servers: ${available}`,
    );
  }

  return resolveServerFromRaw(serverConfig, config.defaults ?? {}, serverName);
}

function resolveServerFromRaw(
  server: RawServerConfig,
  defaults: NonNullable<RawConfig["defaults"]>,
  _serverName: string,
): LoadedServerConfig {
  // Parse command into command + args
  const parts = server.command.split(/\s+/);
  const command = parts[0]!;
  const args = parts.slice(1);

  // Interpolate env vars
  const env = server.env ? interpolateEnvInObject(server.env) : {};

  // Build config resolver
  const defaultsPartial: Partial<ResolvedToolConfig> = {};
  if (defaults.timeout !== undefined) defaultsPartial.timeout = defaults.timeout;
  if (defaults.retries) defaultsPartial.retries = defaults.retries as ResolvedToolConfig["retries"];
  if (defaults.circuit_breaker)
    defaultsPartial.circuit_breaker = defaults.circuit_breaker as ResolvedToolConfig["circuit_breaker"];
  if (defaults.logging)
    defaultsPartial.logging = defaults.logging as ResolvedToolConfig["logging"];

  const serverPartial: Partial<ResolvedToolConfig> = {};
  if (server.timeout !== undefined) serverPartial.timeout = server.timeout;
  if (server.retries) serverPartial.retries = server.retries as ResolvedToolConfig["retries"];
  if (server.circuit_breaker)
    serverPartial.circuit_breaker = server.circuit_breaker as ResolvedToolConfig["circuit_breaker"];
  if (server.logging)
    serverPartial.logging = server.logging as ResolvedToolConfig["logging"];

  const toolOverrides = server.tools ?? {};

  const resolvedLogging = mergeConfigs(defaultsPartial, serverPartial).logging;

  return {
    command,
    args,
    env,
    logging: resolvedLogging,
    resolveToolConfig(toolName: string): ResolvedToolConfig {
      const toolCfg = toolOverrides[toolName];
      if (!toolCfg) {
        return mergeConfigs(defaultsPartial, serverPartial);
      }

      const toolPartial: Partial<ResolvedToolConfig> = {};
      if (toolCfg.timeout !== undefined) toolPartial.timeout = toolCfg.timeout;
      if (toolCfg.retries) toolPartial.retries = toolCfg.retries as ResolvedToolConfig["retries"];

      return mergeConfigs(defaultsPartial, serverPartial, toolPartial);
    },
  };
}

/**
 * Build a server config from CLI inline options (no YAML file).
 */
export function buildInlineServerConfig(options: {
  command: string;
  args: string[];
  timeout?: number;
  retries?: number;
  logLevel?: string;
  logFormat?: string;
}): LoadedServerConfig {
  const overrides: Partial<ResolvedToolConfig> = {};

  if (options.timeout !== undefined) overrides.timeout = options.timeout;
  if (options.retries !== undefined) overrides.retries = { ...BUILT_IN_DEFAULTS.retries, max: options.retries };
  if (options.logLevel || options.logFormat) {
    overrides.logging = {
      level: options.logLevel ?? BUILT_IN_DEFAULTS.logging.level,
      format: (options.logFormat as "json" | "pretty") ?? BUILT_IN_DEFAULTS.logging.format,
    };
  }

  const resolved = mergeConfigs(overrides);

  return {
    command: options.command,
    args: options.args,
    env: {},
    logging: resolved.logging,
    resolveToolConfig: () => resolved,
  };
}
