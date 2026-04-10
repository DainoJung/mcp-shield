import type { MiddlewareFn } from "../middleware/types.js";
import type { MetricsCollector } from "./collector.js";

/**
 * Middleware that records metrics for every tools/call request.
 *
 * Metrics recorded:
 *   mcp_shield_tool_calls_total     — counter (server, tool, status)
 *   mcp_shield_tool_call_duration_ms — histogram (server, tool)
 *   mcp_shield_tool_call_retries    — counter (server, tool)
 */
export function createMetricsMiddleware(collector: MetricsCollector): MiddlewareFn {
  return async (ctx, next) => {
    const start = Date.now();

    const response = await next();
    const duration = Date.now() - start;

    const status = response.error
      ? (response.error.code === -32001
        ? "timeout"
        : response.error.code === -32002
          ? "circuit_open"
          : response.error.code === -32007
            ? "rate_limited"
            : "error")
      : "success";

    const labels = { server: ctx.serverName, tool: ctx.toolName };

    collector.incCounter("mcp_shield_tool_calls_total", { ...labels, status });
    collector.observeHistogram("mcp_shield_tool_call_duration_ms", labels, duration);

    if (ctx.attempt > 1) {
      collector.incCounter("mcp_shield_tool_call_retries", labels, ctx.attempt - 1);
    }

    return response;
  };
}
