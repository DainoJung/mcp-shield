import type { MiddlewareFn } from "./types.js";
import { makeErrorResponse, ErrorCodes } from "../proxy/types.js";
import type { JsonRpcResponse } from "../proxy/types.js";

export interface ToolFilterConfig {
  /** If set, only these tools are exposed. All others are blocked. */
  allow?: string[];
  /** If set, these tools are blocked. All others are allowed. */
  deny?: string[];
}

/**
 * Determine if a tool is allowed based on allow/deny lists.
 * - If `allow` is set, only listed tools pass.
 * - If `deny` is set, listed tools are blocked.
 * - If both are set, `allow` takes precedence.
 */
export function isToolAllowed(toolName: string, filter: ToolFilterConfig): boolean {
  if (filter.allow) {
    return filter.allow.includes(toolName);
  }
  if (filter.deny) {
    return !filter.deny.includes(toolName);
  }
  return true;
}

/**
 * Middleware that blocks tools/call for filtered tools.
 */
export function createToolFilterMiddleware(filter: ToolFilterConfig): MiddlewareFn {
  return async (ctx, next) => {
    if (!isToolAllowed(ctx.toolName, filter)) {
      return makeErrorResponse(
        ctx.request.id,
        ErrorCodes.TOOL_BLOCKED,
        `Tool '${ctx.toolName}' is not allowed by the tool filter configuration.`,
        { type: "tool_blocked", tool: ctx.toolName },
      );
    }
    return next();
  };
}

/**
 * Filter a tools/list response to only include allowed tools.
 * Called at the proxy level for tools/list responses.
 */
export function filterToolListResponse(
  response: JsonRpcResponse,
  filter: ToolFilterConfig,
): JsonRpcResponse {
  if (response.error || !response.result) {
    return response;
  }

  const result = response.result as { tools?: Array<{ name: string }> };
  if (!result.tools || !Array.isArray(result.tools)) {
    return response;
  }

  const filtered = result.tools.filter((tool) => isToolAllowed(tool.name, filter));

  return {
    ...response,
    result: { ...result, tools: filtered },
  };
}
