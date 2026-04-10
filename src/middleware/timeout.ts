import type { MiddlewareFn } from "./types.js";
import { makeErrorResponse, ErrorCodes } from "../proxy/types.js";

export function createTimeoutMiddleware(): MiddlewareFn {
  return async (ctx, next) => {
    const timeoutMs = ctx.config.timeout;
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error("TIMEOUT"));
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([next(), timeoutPromise]);
      clearTimeout(timeoutId!);
      return response;
    } catch (err) {
      clearTimeout(timeoutId!);

      if (timedOut) {
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
