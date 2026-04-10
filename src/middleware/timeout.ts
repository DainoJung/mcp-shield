import type { MiddlewareFn } from "./types.js";
import { makeErrorResponse, ErrorCodes } from "../proxy/types.js";

export function createTimeoutMiddleware(): MiddlewareFn {
  return async (ctx, next) => {
    const timeoutMs = ctx.config.timeout;
    const controller = new AbortController();

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await Promise.race([
        next(),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new Error("TIMEOUT"));
          });
        }),
      ]);

      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.message === "TIMEOUT") {
        return makeErrorResponse(
          ctx.request.id,
          ErrorCodes.TIMEOUT,
          `Tool '${ctx.toolName}' timed out after ${timeoutMs}ms`,
          { type: "timeout", tool: ctx.toolName, timeout_ms: timeoutMs },
        );
      }

      throw err;
    }
  };
}
