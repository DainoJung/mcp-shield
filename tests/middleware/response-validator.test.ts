import { describe, it, expect, vi } from "vitest";
import {
  validateToolResponse,
  createResponseValidatorMiddleware,
} from "../../src/middleware/response-validator.js";
import type { JsonRpcResponse } from "../../src/proxy/types.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import { BUILT_IN_DEFAULTS } from "../../src/config/defaults.js";

function makeCtx(): MiddlewareContext {
  return {
    request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "test_tool" } },
    toolName: "test_tool",
    serverName: "test",
    config: BUILT_IN_DEFAULTS,
    attempt: 1,
    startTime: Date.now(),
  };
}

describe("validateToolResponse", () => {
  it("accepts valid text response", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "hello" }] },
    };
    const { valid, errors } = validateToolResponse(resp);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("accepts error responses as valid", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "fail" },
    };
    const { valid } = validateToolResponse(resp);
    expect(valid).toBe(true);
  });

  it("rejects response missing result", () => {
    const resp: JsonRpcResponse = { jsonrpc: "2.0", id: 1 };
    const { valid, errors } = validateToolResponse(resp);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("result");
  });

  it("rejects response missing content array", () => {
    const resp: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
    const { valid, errors } = validateToolResponse(resp);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("content");
  });

  it("rejects content that is not an array", () => {
    const resp: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: { content: "not array" } };
    const { valid, errors } = validateToolResponse(resp);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("array");
  });

  it("rejects content blocks without type", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ text: "no type" }] },
    };
    const { valid, errors } = validateToolResponse(resp);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("type");
  });

  it("rejects text block without text field", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text" }] },
    };
    const { valid, errors } = validateToolResponse(resp);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("text");
  });

  it("rejects image block without data/mimeType", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "image" }] },
    };
    const { valid, errors } = validateToolResponse(resp);
    expect(valid).toBe(false);
    expect(errors.length).toBe(2);
  });

  it("accepts multiple valid content blocks", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      },
    };
    const { valid } = validateToolResponse(resp);
    expect(valid).toBe(true);
  });
});

describe("createResponseValidatorMiddleware", () => {
  it("passes valid responses through in warn mode", async () => {
    const mw = createResponseValidatorMiddleware("warn");
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "ok" }] },
    };
    const result = await mw(makeCtx(), async () => resp);
    expect(result.result).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it("passes invalid responses through in warn mode", async () => {
    const onError = vi.fn();
    const mw = createResponseValidatorMiddleware("warn", onError);
    const resp: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
    const result = await mw(makeCtx(), async () => resp);
    // Response is returned as-is in warn mode
    expect(result.result).toBeDefined();
    expect(onError).toHaveBeenCalledWith("test_tool", expect.any(Array));
  });

  it("rejects invalid responses in enforce mode", async () => {
    const mw = createResponseValidatorMiddleware("enforce");
    const resp: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
    const result = await mw(makeCtx(), async () => resp);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe(-32006);
    expect(result.error!.message).toContain("validation failed");
  });

  it("passes error responses through in enforce mode", async () => {
    const mw = createResponseValidatorMiddleware("enforce");
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "fail" },
    };
    const result = await mw(makeCtx(), async () => resp);
    expect(result.error!.code).toBe(-32000); // original error, not validation error
  });
});
