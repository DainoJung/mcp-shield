import { describe, it, expect, beforeEach } from "vitest";
import {
  createCircuitBreakerMiddleware,
  CircuitBreakerStore,
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
  let store: CircuitBreakerStore;

  beforeEach(() => {
    store = new CircuitBreakerStore();
  });

  it("passes through in closed state", async () => {
    const mw = createCircuitBreakerMiddleware(undefined, store);
    const ctx = makeCtx();
    const result = await mw(ctx, async () => successResponse());
    expect(result.result).toBeDefined();
    expect(store.getState("test-server")).toBe("closed");
  });

  it("opens after reaching failure threshold", async () => {
    const mw = createCircuitBreakerMiddleware(undefined, store);
    for (let i = 0; i < 3; i++) {
      await mw(makeCtx(), async () => errorResponse());
    }
    expect(store.getState("test-server")).toBe("open");
  });

  it("rejects immediately when circuit is open", async () => {
    const mw = createCircuitBreakerMiddleware(undefined, store);
    for (let i = 0; i < 3; i++) {
      await mw(makeCtx(), async () => errorResponse());
    }

    let nextCalled = false;
    const result = await mw(makeCtx(), async () => {
      nextCalled = true;
      return successResponse();
    });

    expect(nextCalled).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CIRCUIT_OPEN);
    expect(result.error!.message).toContain("OPEN");
  });

  it("transitions to half-open after reset_after", async () => {
    const mw = createCircuitBreakerMiddleware(undefined, store);
    for (let i = 0; i < 3; i++) {
      await mw(makeCtx(), async () => errorResponse());
    }
    expect(store.getState("test-server")).toBe("open");

    await new Promise((r) => setTimeout(r, 150));

    let nextCalled = false;
    await mw(makeCtx(), async () => {
      nextCalled = true;
      return successResponse();
    });
    expect(nextCalled).toBe(true);
    expect(store.getState("test-server")).toBe("closed");
  });

  it("re-opens on half-open failure", async () => {
    const mw = createCircuitBreakerMiddleware(undefined, store);
    for (let i = 0; i < 3; i++) {
      await mw(makeCtx(), async () => errorResponse());
    }

    await new Promise((r) => setTimeout(r, 150));

    await mw(makeCtx(), async () => errorResponse());
    expect(store.getState("test-server")).toBe("open");
  });

  it("resets failure count on success", async () => {
    const mw = createCircuitBreakerMiddleware(undefined, store);
    await mw(makeCtx(), async () => errorResponse());
    await mw(makeCtx(), async () => errorResponse());
    await mw(makeCtx(), async () => successResponse());
    await mw(makeCtx(), async () => errorResponse());
    await mw(makeCtx(), async () => errorResponse());
    expect(store.getState("test-server")).toBe("closed");
  });

  it("maintains per-server state with isolated stores", async () => {
    const storeA = new CircuitBreakerStore();
    const storeB = new CircuitBreakerStore();
    const mwA = createCircuitBreakerMiddleware(undefined, storeA);
    const mwB = createCircuitBreakerMiddleware(undefined, storeB);

    // Trip circuit for server-a
    for (let i = 0; i < 3; i++) {
      await mwA(makeCtx({ serverName: "server-a" }), async () => errorResponse());
    }

    expect(storeA.getState("server-a")).toBe("open");
    expect(storeB.getState("server-a")).toBe("closed"); // different store, unaffected

    const result = await mwB(makeCtx({ serverName: "server-a" }), async () => successResponse());
    expect(result.result).toBeDefined();
  });
});
