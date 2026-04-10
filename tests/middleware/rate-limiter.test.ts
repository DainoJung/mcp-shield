import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimiter, createRateLimiterMiddleware } from "../../src/middleware/rate-limiter.js";
import { ErrorCodes, type JsonRpcResponse } from "../../src/proxy/types.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import { BUILT_IN_DEFAULTS } from "../../src/config/defaults.js";

function makeCtx(toolName = "test_tool"): MiddlewareContext {
  return {
    request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName } },
    toolName,
    serverName: "test",
    config: BUILT_IN_DEFAULTS,
    attempt: 1,
    startTime: Date.now(),
  };
}

function successResponse(): JsonRpcResponse {
  return { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } };
}

describe("RateLimiter", () => {
  it("allows calls within limit", () => {
    const limiter = new RateLimiter({ max_calls: 3, window: 1000 });
    expect(limiter.check("key").allowed).toBe(true);
    expect(limiter.check("key").allowed).toBe(true);
    expect(limiter.check("key").allowed).toBe(true);
  });

  it("blocks calls exceeding limit", () => {
    const limiter = new RateLimiter({ max_calls: 2, window: 1000 });
    expect(limiter.check("key").allowed).toBe(true);
    expect(limiter.check("key").allowed).toBe(true);
    const result = limiter.check("key");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfter).toBeGreaterThan(0);
    }
  });

  it("allows calls again after window expires", async () => {
    const limiter = new RateLimiter({ max_calls: 1, window: 50 });
    expect(limiter.check("key").allowed).toBe(true);
    expect(limiter.check("key").allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 80));
    expect(limiter.check("key").allowed).toBe(true);
  });

  it("tracks different keys independently", () => {
    const limiter = new RateLimiter({ max_calls: 1, window: 1000 });
    expect(limiter.check("key-a").allowed).toBe(true);
    expect(limiter.check("key-b").allowed).toBe(true);
    expect(limiter.check("key-a").allowed).toBe(false);
    expect(limiter.check("key-b").allowed).toBe(false);
  });

  it("reset clears all state", () => {
    const limiter = new RateLimiter({ max_calls: 1, window: 1000 });
    expect(limiter.check("key").allowed).toBe(true);
    expect(limiter.check("key").allowed).toBe(false);
    limiter.reset();
    expect(limiter.check("key").allowed).toBe(true);
  });
});

describe("createRateLimiterMiddleware", () => {
  it("passes calls within limit", async () => {
    const mw = createRateLimiterMiddleware({ max_calls: 5, window: 1000 });
    const next = vi.fn().mockResolvedValue(successResponse());

    for (let i = 0; i < 5; i++) {
      const result = await mw(makeCtx(), next);
      expect(result.result).toBeDefined();
    }
    expect(next).toHaveBeenCalledTimes(5);
  });

  it("blocks calls exceeding limit without calling next", async () => {
    const mw = createRateLimiterMiddleware({ max_calls: 2, window: 1000 });
    const next = vi.fn().mockResolvedValue(successResponse());

    await mw(makeCtx(), next);
    await mw(makeCtx(), next);
    const blocked = await mw(makeCtx(), next);

    expect(blocked.error).toBeDefined();
    expect(blocked.error!.code).toBe(ErrorCodes.RATE_LIMITED);
    expect(blocked.error!.message).toContain("Rate limit exceeded");
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("includes retry_after_ms in error data", async () => {
    const mw = createRateLimiterMiddleware({ max_calls: 1, window: 1000 });
    const next = vi.fn().mockResolvedValue(successResponse());

    await mw(makeCtx(), next);
    const blocked = await mw(makeCtx(), next);

    const data = blocked.error!.data as Record<string, unknown>;
    expect(data.type).toBe("rate_limited");
    expect(data.retry_after_ms).toBeGreaterThan(0);
    expect(data.max_calls).toBe(1);
    expect(data.window_ms).toBe(1000);
  });

  it("tracks different tools independently", async () => {
    const mw = createRateLimiterMiddleware({ max_calls: 1, window: 1000 });
    const next = vi.fn().mockResolvedValue(successResponse());

    const r1 = await mw(makeCtx("tool_a"), next);
    const r2 = await mw(makeCtx("tool_b"), next);
    expect(r1.result).toBeDefined();
    expect(r2.result).toBeDefined();

    const r3 = await mw(makeCtx("tool_a"), next);
    expect(r3.error!.code).toBe(ErrorCodes.RATE_LIMITED);
  });
});
