import { describe, it, expect, vi } from "vitest";
import {
  isToolAllowed,
  createToolFilterMiddleware,
  filterToolListResponse,
} from "../../src/middleware/tool-filter.js";
import { ErrorCodes, type JsonRpcResponse } from "../../src/proxy/types.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import { BUILT_IN_DEFAULTS } from "../../src/config/defaults.js";

function makeCtx(toolName: string): MiddlewareContext {
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

describe("isToolAllowed", () => {
  it("allows all tools when no filter is set", () => {
    expect(isToolAllowed("anything", {})).toBe(true);
  });

  it("allows only listed tools with allow list", () => {
    const filter = { allow: ["read", "write"] };
    expect(isToolAllowed("read", filter)).toBe(true);
    expect(isToolAllowed("write", filter)).toBe(true);
    expect(isToolAllowed("delete", filter)).toBe(false);
  });

  it("blocks listed tools with deny list", () => {
    const filter = { deny: ["delete", "drop"] };
    expect(isToolAllowed("read", filter)).toBe(true);
    expect(isToolAllowed("delete", filter)).toBe(false);
    expect(isToolAllowed("drop", filter)).toBe(false);
  });

  it("allow takes precedence over deny", () => {
    const filter = { allow: ["read"], deny: ["read"] };
    expect(isToolAllowed("read", filter)).toBe(true);
    expect(isToolAllowed("write", filter)).toBe(false);
  });
});

describe("createToolFilterMiddleware", () => {
  it("passes allowed tools through", async () => {
    const mw = createToolFilterMiddleware({ allow: ["test_tool"] });
    const next = vi.fn().mockResolvedValue(successResponse());
    const result = await mw(makeCtx("test_tool"), next);
    expect(result.result).toBeDefined();
    expect(next).toHaveBeenCalled();
  });

  it("blocks denied tools without calling next", async () => {
    const mw = createToolFilterMiddleware({ allow: ["other_tool"] });
    const next = vi.fn().mockResolvedValue(successResponse());
    const result = await mw(makeCtx("test_tool"), next);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe(ErrorCodes.TOOL_BLOCKED);
    expect(result.error!.message).toContain("not allowed");
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks tools on deny list", async () => {
    const mw = createToolFilterMiddleware({ deny: ["dangerous_tool"] });
    const next = vi.fn().mockResolvedValue(successResponse());

    const allowed = await mw(makeCtx("safe_tool"), next);
    expect(allowed.result).toBeDefined();

    const blocked = await mw(makeCtx("dangerous_tool"), next);
    expect(blocked.error!.code).toBe(ErrorCodes.TOOL_BLOCKED);
  });
});

describe("filterToolListResponse", () => {
  const toolsListResponse: JsonRpcResponse = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      tools: [
        { name: "read_file", description: "Read a file" },
        { name: "write_file", description: "Write a file" },
        { name: "delete_file", description: "Delete a file" },
      ],
    },
  };

  it("filters tools/list with allow list", () => {
    const filtered = filterToolListResponse(toolsListResponse, { allow: ["read_file"] });
    const result = filtered.result as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.name).toBe("read_file");
  });

  it("filters tools/list with deny list", () => {
    const filtered = filterToolListResponse(toolsListResponse, { deny: ["delete_file"] });
    const result = filtered.result as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(2);
    expect(result.tools.map((t) => t.name)).toEqual(["read_file", "write_file"]);
  });

  it("passes through error responses unchanged", () => {
    const errResp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "fail" },
    };
    expect(filterToolListResponse(errResp, { allow: ["x"] })).toEqual(errResp);
  });

  it("passes through responses without tools array", () => {
    const resp: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
    expect(filterToolListResponse(resp, { allow: ["x"] })).toEqual(resp);
  });
});
