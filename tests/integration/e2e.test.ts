import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { MessageParser, encodeMessage } from "../../src/proxy/message-parser.js";
import type { JsonRpcMessage, JsonRpcResponse } from "../../src/proxy/types.js";

const MOCK_SERVER_PATH = resolve(__dirname, "../helpers/mock-server.ts");

function spawnMockServer(): ChildProcess {
  return spawn("npx", ["tsx", MOCK_SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function waitForReady(child: ChildProcess, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server startup timed out")), timeoutMs);
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes("started")) {
        clearTimeout(timer);
        child.stderr!.off("data", onData);
        resolve();
      }
    };
    child.stderr!.on("data", onData);
  });
}

function sendAndReceive(
  child: ChildProcess,
  msg: JsonRpcMessage,
  timeoutMs = 5000,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for response")), timeoutMs);
    const parser = new MessageParser();

    const onData = (chunk: Buffer) => {
      parser.feed(chunk);
    };

    parser.on("message", (resp: JsonRpcMessage) => {
      clearTimeout(timer);
      child.stdout!.off("data", onData);
      resolve(resp as JsonRpcResponse);
    });

    child.stdout!.on("data", onData);
    child.stdin!.write(encodeMessage(msg));
  });
}

describe("e2e: mock MCP server", () => {
  let server: ChildProcess;

  afterEach(() => {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  });

  it("handles initialize request", async () => {
    server = spawnMockServer();
    // Wait for server to start
    await waitForReady(server);

    const resp = await sendAndReceive(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    expect(resp.result).toBeDefined();
    const result = resp.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2024-11-05");
  });

  it("handles tools/call echo action", async () => {
    server = spawnMockServer();
    await waitForReady(server);

    const resp = await sendAndReceive(server, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "test_tool",
        arguments: { action: "echo", data: "hello world" },
      },
    });

    expect(resp.result).toBeDefined();
    const result = resp.result as { content: { type: string; text: string }[] };
    expect(result.content[0]!.text).toContain("hello world");
  });

  it("handles tools/call error action", async () => {
    server = spawnMockServer();
    await waitForReady(server);

    const resp = await sendAndReceive(server, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "test_tool",
        arguments: { action: "error", code: -32000, message: "test error" },
      },
    });

    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32000);
  });

  it("handles tools/call delay action", async () => {
    server = spawnMockServer();
    await waitForReady(server);

    const start = Date.now();
    const resp = await sendAndReceive(server, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "test_tool",
        arguments: { action: "delay", ms: 200 },
      },
    });
    const elapsed = Date.now() - start;

    expect(resp.result).toBeDefined();
    expect(elapsed).toBeGreaterThanOrEqual(150); // some tolerance
  });

  it("handles multiple sequential requests", async () => {
    server = spawnMockServer();
    await waitForReady(server);

    for (let i = 1; i <= 3; i++) {
      const resp = await sendAndReceive(server, {
        jsonrpc: "2.0",
        id: i,
        method: "tools/call",
        params: {
          name: "test_tool",
          arguments: { action: "echo", data: `msg-${i}` },
        },
      });
      expect(resp.id).toBe(i);
      expect(resp.result).toBeDefined();
    }
  });
});
