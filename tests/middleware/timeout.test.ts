import { describe, it, expect } from "vitest";
import { createTimeoutMiddleware } from "../../src/middleware/timeout.js";
import { ErrorCodes, type JsonRpcResponse } from "../../src/proxy/types.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import { BUILT_IN_DEFAULTS } from "../../src/config/defaults.js";

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "test_tool" } },
    toolName: "test_tool",
    serverName: "test",
    config: { ...BUILT_IN_DEFAULTS, timeout: 200 },
    attempt: 1,
    startTime: Date.now(),
    ...overrides,
  };
}

function successResponse(id: number | string = 1): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "ok" }] } };
}

describe("timeout middleware", () => {
  const middleware = createTimeoutMiddleware();

  it("passes through when response arrives within timeout", async () => {
    const ctx = makeCtx();
    const result = await middleware(ctx, async () => successResponse());
    expect(result.result).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it("returns timeout error when response exceeds timeout", async () => {
    const ctx = makeCtx({ config: { ...BUILT_IN_DEFAULTS, timeout: 50 } });
    const result = await middleware(ctx, async () => {
      await new Promise((r) => setTimeout(r, 200));
      return successResponse();
    });
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe(ErrorCodes.TIMEOUT);
    expect(result.error!.message).toContain("timed out");
    expect(result.error!.message).toContain("test_tool");
  });

  it("includes timeout_ms in error data", async () => {
    const ctx = makeCtx({ config: { ...BUILT_IN_DEFAULTS, timeout: 50 } });
    const result = await middleware(ctx, async () => {
      await new Promise((r) => setTimeout(r, 200));
      return successResponse();
    });
    const data = result.error!.data as Record<string, unknown>;
    expect(data.type).toBe("timeout");
    expect(data.timeout_ms).toBe(50);
  });

  it("respects per-tool timeout config", async () => {
    // Short timeout should fail
    const shortCtx = makeCtx({ config: { ...BUILT_IN_DEFAULTS, timeout: 30 } });
    const shortResult = await middleware(shortCtx, async () => {
      await new Promise((r) => setTimeout(r, 100));
      return successResponse();
    });
    expect(shortResult.error?.code).toBe(ErrorCodes.TIMEOUT);

    // Long timeout should succeed
    const longCtx = makeCtx({ config: { ...BUILT_IN_DEFAULTS, timeout: 500 } });
    const longResult = await middleware(longCtx, async () => {
      await new Promise((r) => setTimeout(r, 100));
      return successResponse();
    });
    expect(longResult.result).toBeDefined();
  });
});
