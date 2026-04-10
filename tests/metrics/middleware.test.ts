import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetricsCollector } from "../../src/metrics/collector.js";
import { createMetricsMiddleware } from "../../src/metrics/middleware.js";
import type { JsonRpcResponse } from "../../src/proxy/types.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import { BUILT_IN_DEFAULTS } from "../../src/config/defaults.js";

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "test_tool" } },
    toolName: "test_tool",
    serverName: "test",
    config: BUILT_IN_DEFAULTS,
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

describe("createMetricsMiddleware", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  it("records successful call metrics", async () => {
    const mw = createMetricsMiddleware(collector);
    await mw(makeCtx(), async () => successResponse());

    const output = collector.toPrometheus();
    expect(output).toContain('mcp_shield_tool_calls_total{server="test",status="success",tool="test_tool"} 1');
    expect(output).toContain("mcp_shield_tool_call_duration_ms");
  });

  it("records error call metrics", async () => {
    const mw = createMetricsMiddleware(collector);
    await mw(makeCtx(), async () => errorResponse());

    const output = collector.toPrometheus();
    expect(output).toContain('status="error"');
  });

  it("records timeout status", async () => {
    const mw = createMetricsMiddleware(collector);
    await mw(makeCtx(), async () => errorResponse(-32001));

    const output = collector.toPrometheus();
    expect(output).toContain('status="timeout"');
  });

  it("records circuit_open status", async () => {
    const mw = createMetricsMiddleware(collector);
    await mw(makeCtx(), async () => errorResponse(-32002));

    const output = collector.toPrometheus();
    expect(output).toContain('status="circuit_open"');
  });

  it("records retry count when attempt > 1", async () => {
    const mw = createMetricsMiddleware(collector);
    await mw(makeCtx({ attempt: 3 }), async () => successResponse());

    const output = collector.toPrometheus();
    expect(output).toContain("mcp_shield_tool_call_retries");
    // 3rd attempt means 2 retries
    expect(output).toContain("2");
  });

  it("does not record retries when attempt is 1", async () => {
    const mw = createMetricsMiddleware(collector);
    await mw(makeCtx({ attempt: 1 }), async () => successResponse());

    const output = collector.toPrometheus();
    expect(output).not.toContain("mcp_shield_tool_call_retries");
  });

  it("accumulates metrics across multiple calls", async () => {
    const mw = createMetricsMiddleware(collector);
    await mw(makeCtx(), async () => successResponse());
    await mw(makeCtx(), async () => successResponse());
    await mw(makeCtx(), async () => errorResponse());

    const output = collector.toPrometheus();
    expect(output).toContain('status="success"');
    expect(output).toContain('status="error"');
  });
});
