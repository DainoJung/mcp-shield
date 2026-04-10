import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { MessageParser, encodeMessage } from "./message-parser.js";
import {
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  isToolsCall,
  isResponse,
  makeErrorResponse,
  ErrorCodes,
} from "./types.js";
import type { MiddlewareFn, MiddlewareContext } from "../middleware/types.js";
import type { ResolvedToolConfig } from "../config/defaults.js";

export interface StdioProxyOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  serverName: string;
  middleware: MiddlewareFn;
  resolveToolConfig: (toolName: string) => ResolvedToolConfig;
}

export class StdioProxy extends EventEmitter {
  private child: ChildProcess | null = null;
  private agentParser = new MessageParser();
  private serverParser = new MessageParser();
  private pendingRequests = new Map<
    number | string,
    { resolve: (resp: JsonRpcResponse) => void; reject: (err: Error) => void }
  >();
  private readonly options: StdioProxyOptions;

  constructor(options: StdioProxyOptions) {
    super();
    this.options = options;
  }

  start(): void {
    const { command, args = [], env = {} } = this.options;

    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...env },
    });

    this.child.on("error", (err) => {
      this.emit("error", new Error(`Failed to spawn server '${this.options.serverName}': ${err.message}. Check that the command exists and is executable.`));
    });

    this.child.on("exit", (code, signal) => {
      // Resolve any pending requests with server crash error
      for (const [id, pending] of this.pendingRequests) {
        pending.resolve(
          makeErrorResponse(
            id,
            ErrorCodes.SERVER_CRASH,
            `Server '${this.options.serverName}' exited unexpectedly (code=${code}, signal=${signal}). Restart the server and try again.`,
            { type: "server_crash", code, signal },
          ),
        );
      }
      this.pendingRequests.clear();
      this.emit("exit", code, signal);
    });

    // Agent → Proxy: parse incoming messages from agent (our stdin)
    this.agentParser.on("message", (msg: JsonRpcMessage) => {
      this.handleAgentMessage(msg);
    });
    this.agentParser.on("error", (err: Error) => {
      this.emit("error", err);
    });

    process.stdin.on("data", (chunk: Buffer) => {
      this.agentParser.feed(chunk);
    });

    // Server → Proxy: parse responses from child server
    this.serverParser.on("message", (msg: JsonRpcMessage) => {
      this.handleServerMessage(msg);
    });
    this.serverParser.on("error", (err: Error) => {
      this.emit("error", err);
    });

    this.child.stdout!.on("data", (chunk: Buffer) => {
      this.serverParser.feed(chunk);
    });

    // Graceful shutdown
    const shutdown = (signal: NodeJS.Signals) => {
      if (this.child && !this.child.killed) {
        this.child.kill(signal);
      }
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }

  private handleAgentMessage(msg: JsonRpcMessage): void {
    if (isToolsCall(msg)) {
      this.handleToolsCall(msg);
    } else {
      // Forward non-tools/call messages directly to child
      this.forwardToServer(msg);
    }
  }

  private async handleToolsCall(request: JsonRpcRequest): Promise<void> {
    const toolName = (request.params?.name as string) ?? "unknown";
    const config = this.options.resolveToolConfig(toolName);

    const ctx: MiddlewareContext = {
      request,
      toolName,
      serverName: this.options.serverName,
      config,
      attempt: 1,
      startTime: Date.now(),
    };

    try {
      const response = await this.options.middleware(ctx, () => this.forwardAndWait(request));
      this.sendToAgent(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendToAgent(
        makeErrorResponse(request.id, -32000, `Middleware error: ${message}`),
      );
    }
  }

  private forwardAndWait(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });
      this.forwardToServer(request);
    });
  }

  private handleServerMessage(msg: JsonRpcMessage): void {
    if (isResponse(msg) && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      pending.resolve(msg);
    } else {
      // Forward non-pending messages (notifications, other responses) to agent
      this.sendToAgent(msg);
    }
  }

  private forwardToServer(msg: JsonRpcMessage): void {
    if (this.child?.stdin?.writable) {
      this.child.stdin.write(encodeMessage(msg));
    }
  }

  private sendToAgent(msg: JsonRpcMessage): void {
    process.stdout.write(encodeMessage(msg));
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }
}
