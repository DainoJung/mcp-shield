import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { MessageParser, encodeMessage } from "../../src/proxy/message-parser.js";
import type { JsonRpcMessage, JsonRpcResponse, JsonRpcRequest } from "../../src/proxy/types.js";

/**
 * Test multi-server concept by verifying that two mock servers
 * can run simultaneously and respond to different tool calls.
 * (Full MultiServerProxy integration requires stdio takeover,
 * so we test the routing logic via the underlying components.)
 */

const MOCK_SERVER_PATH = resolve(__dirname, "../helpers/mock-server.ts");

function spawnMockServer(): ChildProcess {
  return spawn("npx", ["tsx", MOCK_SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function sendAndReceive(
  child: ChildProcess,
  msg: JsonRpcMessage,
  timeoutMs = 5000,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
    const parser = new MessageParser();
    const onData = (chunk: Buffer) => parser.feed(chunk);

    parser.on("message", (resp: JsonRpcMessage) => {
      clearTimeout(timer);
      child.stdout!.off("data", onData);
      resolve(resp as JsonRpcResponse);
    });

    child.stdout!.on("data", onData);
    child.stdin!.write(encodeMessage(msg));
  });
}

describe("multi-server: parallel mock servers", () => {
  const servers: ChildProcess[] = [];

  afterEach(() => {
    for (const s of servers) {
      if (!s.killed) s.kill("SIGTERM");
    }
    servers.length = 0;
  });

  it("two servers can run and respond independently", async () => {
    const server1 = spawnMockServer();
    const server2 = spawnMockServer();
    servers.push(server1, server2);
    await new Promise((r) => setTimeout(r, 500));

    // Both can initialize
    const init1 = await sendAndReceive(server1, {
      jsonrpc: "2.0", id: 1, method: "initialize", params: {},
    });
    const init2 = await sendAndReceive(server2, {
      jsonrpc: "2.0", id: 1, method: "initialize", params: {},
    });
    expect(init1.result).toBeDefined();
    expect(init2.result).toBeDefined();
  });

  it("each server responds to its own tools/call", async () => {
    const server1 = spawnMockServer();
    const server2 = spawnMockServer();
    servers.push(server1, server2);
    await new Promise((r) => setTimeout(r, 500));

    const resp1 = await sendAndReceive(server1, {
      jsonrpc: "2.0", id: 10, method: "tools/call",
      params: { name: "test_tool", arguments: { action: "echo", data: "from-server-1" } },
    });
    const resp2 = await sendAndReceive(server2, {
      jsonrpc: "2.0", id: 20, method: "tools/call",
      params: { name: "test_tool", arguments: { action: "echo", data: "from-server-2" } },
    });

    const text1 = ((resp1.result as any).content[0].text);
    const text2 = ((resp2.result as any).content[0].text);
    expect(text1).toContain("from-server-1");
    expect(text2).toContain("from-server-2");
    expect(resp1.id).toBe(10);
    expect(resp2.id).toBe(20);
  });

  it("servers can have different response characteristics", async () => {
    const fastServer = spawnMockServer();
    const slowServer = spawnMockServer();
    servers.push(fastServer, slowServer);
    await new Promise((r) => setTimeout(r, 500));

    const start = Date.now();

    // Fast server: instant echo
    const fast = await sendAndReceive(fastServer, {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "test_tool", arguments: { action: "echo", data: "fast" } },
    });

    // Slow server: 200ms delay
    const slow = await sendAndReceive(slowServer, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "test_tool", arguments: { action: "delay", ms: 200 } },
    });

    expect(fast.result).toBeDefined();
    expect(slow.result).toBeDefined();
  });

  it("tools/list from both servers can be merged", async () => {
    const server1 = spawnMockServer();
    const server2 = spawnMockServer();
    servers.push(server1, server2);
    await new Promise((r) => setTimeout(r, 500));

    const list1 = await sendAndReceive(server1, {
      jsonrpc: "2.0", id: 1, method: "tools/list",
    });
    const list2 = await sendAndReceive(server2, {
      jsonrpc: "2.0", id: 2, method: "tools/list",
    });

    const tools1 = (list1.result as any).tools as Array<{ name: string }>;
    const tools2 = (list2.result as any).tools as Array<{ name: string }>;

    // Merge
    const merged = [...tools1, ...tools2];
    expect(merged.length).toBe(tools1.length + tools2.length);
    expect(merged.some((t) => t.name === "test_tool")).toBe(true);
  });
});
