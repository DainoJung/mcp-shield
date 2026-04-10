/**
 * Minimal mock MCP server for testing.
 * Communicates via stdio with Content-Length framing.
 *
 * Behaviors controlled by tool arguments:
 *   { "action": "echo", "data": "hello" }    → success response with data
 *   { "action": "delay", "ms": 5000 }        → respond after delay
 *   { "action": "error", "code": -32000 }    → error response
 *   { "action": "fail_then_succeed", "fail_count": 2 } → fail N times then succeed
 *   { "action": "hang" }                     → never respond (for timeout testing)
 *   { "action": "crash" }                    → process.exit(1)
 */

import { createInterface } from "node:readline";

let failCounter = 0;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function encode(msg: JsonRpcResponse): void {
  const body = JSON.stringify(msg);
  const buf = Buffer.from(body, "utf-8");
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`);
  process.stdout.write(buf);
}

function handleRequest(req: JsonRpcRequest): void {
  if (req.method === "initialize") {
    encode({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mock-server", version: "1.0.0" },
      },
    });
    return;
  }

  if (req.method === "tools/list") {
    encode({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        tools: [
          { name: "test_tool", description: "A test tool", inputSchema: { type: "object" } },
        ],
      },
    });
    return;
  }

  if (req.method === "tools/call") {
    const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
    const action = args.action as string;

    switch (action) {
      case "echo":
        encode({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(args.data ?? "ok") }],
          },
        });
        break;

      case "delay":
        setTimeout(() => {
          encode({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [{ type: "text", text: "delayed_response" }],
            },
          });
        }, (args.ms as number) ?? 1000);
        break;

      case "error":
        encode({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: (args.code as number) ?? -32000,
            message: (args.message as string) ?? "Mock error",
          },
        });
        break;

      case "fail_then_succeed": {
        const threshold = (args.fail_count as number) ?? 2;
        failCounter++;
        if (failCounter <= threshold) {
          encode({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32000, message: `Failure ${failCounter}/${threshold}` },
          });
        } else {
          failCounter = 0;
          encode({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [{ type: "text", text: "success_after_failures" }],
            },
          });
        }
        break;
      }

      case "hang":
        // Intentionally never respond
        break;

      case "crash":
        process.exit(1);
        break;

      default:
        encode({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [{ type: "text", text: "default_response" }],
          },
        });
    }
    return;
  }

  // Unknown method — just echo back
  encode({ jsonrpc: "2.0", id: req.id, result: {} });
}

// Parse Content-Length framed messages from stdin
let buffer = Buffer.alloc(0);
let contentLength: number | null = null;

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    if (contentLength === null) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = buffer.subarray(0, headerEnd).toString("utf-8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }

      contentLength = parseInt(match[1]!, 10);
      buffer = buffer.subarray(headerEnd + 4);
    }

    if (buffer.length < contentLength) return;

    const body = buffer.subarray(0, contentLength).toString("utf-8");
    buffer = buffer.subarray(contentLength);
    contentLength = null;

    try {
      const msg = JSON.parse(body) as JsonRpcRequest;
      handleRequest(msg);
    } catch {
      process.stderr.write(`mock-server: failed to parse: ${body.slice(0, 100)}\n`);
    }
  }
});

process.stderr.write("mock-server: started\n");
