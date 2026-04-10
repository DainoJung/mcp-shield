import { describe, it, expect, vi } from "vitest";
import { createRetryMiddleware } from "../../src/middleware/retry.js";
import { ErrorCodes, type JsonRpcResponse } from "../../src/proxy/types.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import { BUILT_IN_DEFAULTS } from "../../src/config/defaults.js";

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "test_tool" } },
    toolName: "test_tool",
    serverName: "test",
    config: {
      ...BUILT_IN_DEFAULTS,
      retries: { max: 3, backoff: "fixed", base_delay: 10, max_delay: 100, jitter: false },
    },
    attempt: 1,
    startTime: Date.now(),
    ...overrides,
  };
}

function successResponse(): JsonRpcResponse {
  return { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } };
}

function errorResponse(code = -32000): JsonRpcResponse {
  return { jsonrpc: "2.0", id: 1, error: { code, message: "fail" } };
}

describe("retry middleware", () => {
  const middleware = createRetryMiddleware();

  it("returns immediately on first success", async () => {
    const next = vi.fn().mockResolvedValue(successResponse());
    const ctx = makeCtx();
    const result = await middleware(ctx, next);
    expect(result.result).toBeDefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and returns success", async () => {
    const next = vi
      .fn()
      .mockResolvedValueOnce(errorResponse())
      .mockResolvedValueOnce(errorResponse())
      .mockResolvedValueOnce(successResponse());
    const ctx = makeCtx();
    const result = await middleware(ctx, next);
    expect(result.result).toBeDefined();
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("returns last error after exhausting all retries", async () => {
    const next = vi.fn().mockResolvedValue(errorResponse());
    const ctx = makeCtx();
    const result = await middleware(ctx, next);
    expect(result.error).toBeDefined();
    // 1 initial + 3 retries = 4 calls
    expect(next).toHaveBeenCalledTimes(4);
  });

  it("does NOT retry timeout errors", async () => {
    const next = vi.fn().mockResolvedValue(errorResponse(ErrorCodes.TIMEOUT));
    const ctx = makeCtx();
    const result = await middleware(ctx, next);
    expect(result.error!.code).toBe(ErrorCodes.TIMEOUT);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry invalid params errors", async () => {
    const next = vi.fn().mockResolvedValue(errorResponse(ErrorCodes.INVALID_PARAMS));
    const ctx = makeCtx();
    const result = await middleware(ctx, next);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_PARAMS);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry method not found errors", async () => {
    const next = vi.fn().mockResolvedValue(errorResponse(ErrorCodes.METHOD_NOT_FOUND));
    const ctx = makeCtx();
    const result = await middleware(ctx, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("updates attempt counter on context", async () => {
    const ctx = makeCtx();
    const attempts: number[] = [];
    const next = vi.fn().mockImplementation(async () => {
      attempts.push(ctx.attempt);
      if (attempts.length < 3) return errorResponse();
      return successResponse();
    });
    await middleware(ctx, next);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("respects max retries = 0 (no retries)", async () => {
    const ctx = makeCtx({
      config: {
        ...BUILT_IN_DEFAULTS,
        retries: { max: 0, backoff: "fixed", base_delay: 10, max_delay: 100, jitter: false },
      },
    });
    const next = vi.fn().mockResolvedValue(errorResponse());
    const result = await middleware(ctx, next);
    expect(result.error).toBeDefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
