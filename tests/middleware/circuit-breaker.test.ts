import { describe, it, expect, beforeEach } from "vitest";
import {
  createCircuitBreakerMiddleware,
  resetAllCircuitBreakers,
  getCircuitState,
} from "../../src/middleware/circuit-breaker.js";
import { ErrorCodes, type JsonRpcResponse } from "../../src/proxy/types.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import { BUILT_IN_DEFAULTS } from "../../src/config/defaults.js";

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "test_tool" } },
    toolName: "test_tool",
    serverName: "test-server",
    config: {
      ...BUILT_IN_DEFAULTS,
      circuit_breaker: { threshold: 3, reset_after: 100 },
    },
    attempt: 1,
    startTime: Date.now(),
    ...overrides,
  };
}

function successResponse(): JsonRpcResponse {
  return { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } };
}

function errorResponse(): JsonRpcResponse {
  return { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "fail" } };
}

describe("circuit breaker middleware", () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
  });

  const middleware = createCircuitBreakerMiddleware();

  it("passes through in closed state", async () => {
    const ctx = makeCtx();
    const result = await middleware(ctx, async () => successResponse());
    expect(result.result).toBeDefined();
    expect(getCircuitState("test-server")).toBe("closed");
  });

  it("opens after reaching failure threshold", async () => {
    for (let i = 0; i < 3; i++) {
      const ctx = makeCtx();
      await middleware(ctx, async () => errorResponse());
    }
    expect(getCircuitState("test-server")).toBe("open");
  });

  it("rejects immediately when circuit is open", async () => {
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await middleware(makeCtx(), async () => errorResponse());
    }

    // Next request should be rejected without calling next
    let nextCalled = false;
    const result = await middleware(makeCtx(), async () => {
      nextCalled = true;
      return successResponse();
    });

    expect(nextCalled).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CIRCUIT_OPEN);
    expect(result.error!.message).toContain("OPEN");
  });

  it("transitions to half-open after reset_after", async () => {
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await middleware(makeCtx(), async () => errorResponse());
    }
    expect(getCircuitState("test-server")).toBe("open");

    // Wait for reset_after
    await new Promise((r) => setTimeout(r, 150));

    // Next request should go through (half-open)
    let nextCalled = false;
    await middleware(makeCtx(), async () => {
      nextCalled = true;
      return successResponse();
    });
    expect(nextCalled).toBe(true);
    expect(getCircuitState("test-server")).toBe("closed");
  });

  it("re-opens on half-open failure", async () => {
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await middleware(makeCtx(), async () => errorResponse());
    }

    // Wait for reset_after
    await new Promise((r) => setTimeout(r, 150));

    // Fail during half-open
    await middleware(makeCtx(), async () => errorResponse());
    expect(getCircuitState("test-server")).toBe("open");
  });

  it("resets failure count on success", async () => {
    // 2 failures (below threshold of 3)
    await middleware(makeCtx(), async () => errorResponse());
    await middleware(makeCtx(), async () => errorResponse());

    // Success resets the counter
    await middleware(makeCtx(), async () => successResponse());

    // 2 more failures — should NOT open (counter was reset)
    await middleware(makeCtx(), async () => errorResponse());
    await middleware(makeCtx(), async () => errorResponse());
    expect(getCircuitState("test-server")).toBe("closed");
  });

  it("maintains per-server state", async () => {
    const mw = createCircuitBreakerMiddleware();

    // Trip circuit for server-a
    for (let i = 0; i < 3; i++) {
      await mw(makeCtx({ serverName: "server-a" }), async () => errorResponse());
    }

    expect(getCircuitState("server-a")).toBe("open");
    expect(getCircuitState("server-b")).toBe("closed");

    // server-b should still work
    const result = await mw(makeCtx({ serverName: "server-b" }), async () => successResponse());
    expect(result.result).toBeDefined();
  });
});
