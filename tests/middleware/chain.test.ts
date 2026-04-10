import { describe, it, expect } from "vitest";
import { composeMiddleware } from "../../src/middleware/chain.js";
import type { MiddlewareFn, MiddlewareContext } from "../../src/middleware/types.js";
import type { JsonRpcResponse } from "../../src/proxy/types.js";
import { BUILT_IN_DEFAULTS } from "../../src/config/defaults.js";

function makeCtx(): MiddlewareContext {
  return {
    request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "test" } },
    toolName: "test",
    serverName: "test",
    config: BUILT_IN_DEFAULTS,
    attempt: 1,
    startTime: Date.now(),
  };
}

function successResponse(): JsonRpcResponse {
  return { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } };
}

describe("composeMiddleware", () => {
  it("executes middlewares in order (outermost first)", async () => {
    const order: string[] = [];

    const mw1: MiddlewareFn = async (ctx, next) => {
      order.push("mw1-before");
      const result = await next();
      order.push("mw1-after");
      return result;
    };

    const mw2: MiddlewareFn = async (ctx, next) => {
      order.push("mw2-before");
      const result = await next();
      order.push("mw2-after");
      return result;
    };

    const chain = composeMiddleware([mw1, mw2]);
    await chain(makeCtx(), async () => {
      order.push("final");
      return successResponse();
    });

    expect(order).toEqual(["mw1-before", "mw2-before", "final", "mw2-after", "mw1-after"]);
  });

  it("works with empty middleware array", async () => {
    const chain = composeMiddleware([]);
    const result = await chain(makeCtx(), async () => successResponse());
    expect(result.result).toBeDefined();
  });

  it("allows middleware to short-circuit", async () => {
    const shortCircuit: MiddlewareFn = async () => {
      return { jsonrpc: "2.0", id: 1, error: { code: -1, message: "blocked" } };
    };

    let finalCalled = false;
    const chain = composeMiddleware([shortCircuit]);
    const result = await chain(makeCtx(), async () => {
      finalCalled = true;
      return successResponse();
    });

    expect(result.error?.message).toBe("blocked");
    expect(finalCalled).toBe(false);
  });

  it("rejects if next() is called multiple times", async () => {
    const badMiddleware: MiddlewareFn = async (ctx, next) => {
      await next();
      return next(); // second call should throw
    };

    const chain = composeMiddleware([badMiddleware]);
    await expect(chain(makeCtx(), async () => successResponse())).rejects.toThrow(
      "next() called multiple times",
    );
  });
});
