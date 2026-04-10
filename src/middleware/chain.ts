import type { MiddlewareFn, MiddlewareContext, NextFn } from "./types.js";
import type { JsonRpcResponse } from "../proxy/types.js";

/**
 * Compose an array of middleware functions into a single middleware.
 * Execution order: first middleware in the array is outermost (runs first).
 */
export function composeMiddleware(middlewares: MiddlewareFn[]): MiddlewareFn {
  return (ctx: MiddlewareContext, finalNext: NextFn): Promise<JsonRpcResponse> => {
    let index = -1;

    function dispatch(i: number): Promise<JsonRpcResponse> {
      if (i <= index) {
        return Promise.reject(new Error("next() called multiple times"));
      }
      index = i;

      const fn = i < middlewares.length ? middlewares[i] : undefined;
      if (!fn) {
        return finalNext();
      }

      return fn(ctx, () => dispatch(i + 1));
    }

    return dispatch(0);
  };
}
