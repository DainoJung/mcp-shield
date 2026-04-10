import { StdioProxy } from "./proxy/stdio-proxy.js";
import { composeMiddleware } from "./middleware/chain.js";
import { createTimeoutMiddleware } from "./middleware/timeout.js";
import { createRetryMiddleware } from "./middleware/retry.js";
import { createCircuitBreakerMiddleware } from "./middleware/circuit-breaker.js";
import { createLogger, createLoggerMiddleware, createCircuitBreakerLogger } from "./middleware/logger.js";
import { buildInlineServerConfig } from "./config/loader.js";

// Re-export everything
export { StdioProxy, type StdioProxyOptions } from "./proxy/stdio-proxy.js";
export { MessageParser, encodeMessage } from "./proxy/message-parser.js";
export {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcMessage,
  type JsonRpcError,
  ErrorCodes,
  isRequest,
  isResponse,
  isNotification,
  isToolsCall,
  makeErrorResponse,
} from "./proxy/types.js";

export { composeMiddleware } from "./middleware/chain.js";
export { createTimeoutMiddleware } from "./middleware/timeout.js";
export { createRetryMiddleware } from "./middleware/retry.js";
export {
  createCircuitBreakerMiddleware,
  resetAllCircuitBreakers,
  getCircuitState,
} from "./middleware/circuit-breaker.js";
export {
  createLogger,
  createLoggerMiddleware,
  createCircuitBreakerLogger,
} from "./middleware/logger.js";
export {
  createResponseValidatorMiddleware,
  validateToolResponse,
  type ValidationMode,
  type ValidationResult,
} from "./middleware/response-validator.js";
export {
  createToolFilterMiddleware,
  filterToolListResponse,
  isToolAllowed,
  type ToolFilterConfig,
} from "./middleware/tool-filter.js";
export {
  createRateLimiterMiddleware,
  RateLimiter,
  type RateLimitConfig,
} from "./middleware/rate-limiter.js";
export { MultiServerProxy, type ServerEntry } from "./proxy/multi-server-proxy.js";
export { MetricsCollector, type MetricLabels } from "./metrics/collector.js";
export { createMetricsMiddleware } from "./metrics/middleware.js";
export { createMetricsServer } from "./metrics/server.js";
export type { MiddlewareFn, MiddlewareContext, NextFn } from "./middleware/types.js";

export { BUILT_IN_DEFAULTS, mergeConfigs, type ResolvedToolConfig } from "./config/defaults.js";
export { parseDuration, configSchema } from "./config/schema.js";
export {
  loadConfigFile,
  resolveServerConfig,
  buildInlineServerConfig,
} from "./config/loader.js";

/**
 * High-level convenience: create a shielded MCP server proxy.
 */
export function shield(options: {
  command: string;
  timeout?: number;
  retries?: { max?: number; backoff?: "exponential" | "linear" | "fixed"; jitter?: boolean };
  circuitBreaker?: { threshold?: number; resetAfter?: number };
  logLevel?: string;
  logFormat?: "json" | "pretty";
}): StdioProxy {
  const parts = options.command.split(/\s+/);
  const serverConfig = buildInlineServerConfig({
    command: parts[0]!,
    args: parts.slice(1),
    timeout: options.timeout,
    retries: options.retries?.max,
    logLevel: options.logLevel,
    logFormat: options.logFormat,
  });

  const logger = createLogger(serverConfig.logging);
  const middleware = composeMiddleware([
    createLoggerMiddleware(logger),
    createTimeoutMiddleware(),
    createRetryMiddleware(),
    createCircuitBreakerMiddleware(createCircuitBreakerLogger(logger)),
  ]);

  return new StdioProxy({
    command: serverConfig.command,
    args: serverConfig.args,
    env: {},
    serverName: "default",
    middleware,
    resolveToolConfig: serverConfig.resolveToolConfig,
  });
}
