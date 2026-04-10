import pino from "pino";
import type { MiddlewareFn } from "./types.js";
import type { CircuitBreakerEvents } from "./circuit-breaker.js";

export interface LoggerOptions {
  level: string;
  format: "json" | "pretty";
}

export function createLogger(options: LoggerOptions): pino.Logger {
  const transport =
    options.format === "pretty"
      ? { target: "pino-pretty", options: { destination: 2 } } // stderr fd
      : undefined;

  return pino({
    level: options.level,
    // Always write to stderr — stdout is reserved for MCP protocol
    ...(transport ? { transport } : {}),
  }, transport ? undefined : pino.destination(2));
}

export function createLoggerMiddleware(logger: pino.Logger): MiddlewareFn {
  return async (ctx, next) => {
    logger.info({
      msg: "tool_call_start",
      server: ctx.serverName,
      tool: ctx.toolName,
      request_id: ctx.request.id,
    });

    const startTime = Date.now();

    try {
      const response = await next();
      const durationMs = Date.now() - startTime;

      const status = response.error
        ? (response.error.code === -32001
          ? "timeout"
          : response.error.code === -32002
            ? "circuit_open"
            : "error")
        : "success";

      const logFn = response.error ? logger.error.bind(logger) : logger.info.bind(logger);
      logFn({
        msg: "tool_call_end",
        server: ctx.serverName,
        tool: ctx.toolName,
        request_id: ctx.request.id,
        duration_ms: durationMs,
        status,
        attempt: ctx.attempt,
      });

      return response;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      logger.error({
        msg: "tool_call_end",
        server: ctx.serverName,
        tool: ctx.toolName,
        request_id: ctx.request.id,
        duration_ms: durationMs,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

export function createCircuitBreakerLogger(logger: pino.Logger): CircuitBreakerEvents {
  return {
    onStateChange(serverName, from, to, failures) {
      logger.warn({
        msg: "circuit_breaker_state_change",
        server: serverName,
        from,
        to,
        consecutive_failures: failures,
      });
    },
  };
}
