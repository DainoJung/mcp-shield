import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { MessageParser, encodeMessage } from "./message-parser.js";
import {
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  isRequest,
  isToolsCall,
  isResponse,
  makeErrorResponse,
  ErrorCodes,
} from "./types.js";
import type { MiddlewareFn, MiddlewareContext } from "../middleware/types.js";
import type { ResolvedToolConfig } from "../config/defaults.js";
import { filterToolListResponse, type ToolFilterConfig } from "../middleware/tool-filter.js";

export interface ServerEntry {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  middleware: MiddlewareFn;
  resolveToolConfig: (toolName: string) => ResolvedToolConfig;
  toolFilter?: ToolFilterConfig;
}

interface RunningServer {
  entry: ServerEntry;
  child: ChildProcess;
  parser: MessageParser;
  pendingRequests: Map<
    number | string,
    { resolve: (resp: JsonRpcResponse) => void }
  >;
  tools: string[];
}

/**
 * Multi-server proxy that merges multiple MCP servers behind a single stdio interface.
 *
 * - Merges tools/list from all servers (prefixing tool names to avoid collisions)
 * - Routes tools/call to the correct server based on tool name
 * - Applies per-server middleware chains
 */
export class MultiServerProxy extends EventEmitter {
  private servers = new Map<string, RunningServer>();
  private toolToServer = new Map<string, string>();
  private agentParser = new MessageParser();
  private readonly entries: ServerEntry[];
  private nextId = 100_000; // internal IDs for proxied requests

  constructor(entries: ServerEntry[]) {
    super();
    this.entries = entries;
  }

  async start(): Promise<void> {
    // Spawn all servers
    for (const entry of this.entries) {
      const child = spawn(entry.command, entry.args, {
        stdio: ["pipe", "pipe", "inherit"],
        env: { ...process.env, ...entry.env },
      });

      const parser = new MessageParser();
      const running: RunningServer = {
        entry,
        child,
        parser,
        pendingRequests: new Map(),
        tools: [],
      };

      child.on("error", (err) => {
        this.emit("error", new Error(`Server '${entry.name}' failed to spawn: ${err.message}`));
      });

      child.on("exit", (code, signal) => {
        // Resolve pending requests
        for (const [id, pending] of running.pendingRequests) {
          pending.resolve(
            makeErrorResponse(id, ErrorCodes.SERVER_CRASH, `Server '${entry.name}' exited (code=${code}, signal=${signal})`),
          );
        }
        running.pendingRequests.clear();
        this.emit("server_exit", entry.name, code, signal);
      });

      parser.on("message", (msg: JsonRpcMessage) => {
        this.handleServerMessage(entry.name, msg);
      });

      child.stdout!.on("data", (chunk: Buffer) => {
        parser.feed(chunk);
      });

      this.servers.set(entry.name, running);
    }

    // Initialize all servers and discover tools
    await this.initializeServers();

    // Start listening to agent stdin
    this.agentParser.on("message", (msg: JsonRpcMessage) => {
      this.handleAgentMessage(msg);
    });
    this.agentParser.on("error", (err: Error) => {
      this.emit("error", err);
    });

    process.stdin.on("data", (chunk: Buffer) => {
      this.agentParser.feed(chunk);
    });

    // Graceful shutdown
    const shutdown = (signal: NodeJS.Signals) => {
      for (const server of this.servers.values()) {
        if (!server.child.killed) {
          server.child.kill(signal);
        }
      }
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }

  private async initializeServers(): Promise<void> {
    for (const [name, server] of this.servers) {
      // Send initialize
      const initId = this.nextId++;
      const initResp = await this.sendToServerAndWait(name, {
        jsonrpc: "2.0",
        id: initId,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mcp-shield-multi", version: "0.1.0" },
        },
      });

      if (initResp.error) {
        this.emit("error", new Error(`Failed to initialize server '${name}': ${initResp.error.message}`));
        continue;
      }

      // Send initialized notification
      this.sendToServer(name, { jsonrpc: "2.0", method: "initialized" });

      // Get tools list
      const toolsId = this.nextId++;
      let toolsResp = await this.sendToServerAndWait(name, {
        jsonrpc: "2.0",
        id: toolsId,
        method: "tools/list",
      });

      // Apply tool filter if configured
      if (server.entry.toolFilter) {
        toolsResp = filterToolListResponse(toolsResp, server.entry.toolFilter);
      }

      const result = toolsResp.result as { tools?: Array<{ name: string }> } | undefined;
      if (result?.tools) {
        for (const tool of result.tools) {
          server.tools.push(tool.name);
          this.toolToServer.set(tool.name, name);
        }
      }
    }
  }

  private handleAgentMessage(msg: JsonRpcMessage): void {
    if (isRequest(msg) && msg.method === "initialize") {
      // Respond with merged capabilities
      this.sendToAgent({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mcp-shield-multi", version: "0.1.0" },
        },
      });
      return;
    }

    if (isRequest(msg) && msg.method === "tools/list") {
      this.handleToolsList(msg);
      return;
    }

    if (isToolsCall(msg)) {
      this.handleToolsCall(msg);
      return;
    }

    // Broadcast other requests to all servers (or ignore notifications)
    // For simplicity, drop unrecognized messages
  }

  private handleToolsList(request: JsonRpcRequest): void {
    // Merge tool lists from all servers
    const allTools: Array<{ name: string; description?: string }> = [];

    for (const server of this.servers.values()) {
      for (const toolName of server.tools) {
        allTools.push({ name: toolName });
      }
    }

    this.sendToAgent({
      jsonrpc: "2.0",
      id: request.id,
      result: { tools: allTools },
    });
  }

  private async handleToolsCall(request: JsonRpcRequest): Promise<void> {
    const toolName = (request.params?.name as string) ?? "unknown";
    const serverName = this.toolToServer.get(toolName);

    if (!serverName) {
      this.sendToAgent(
        makeErrorResponse(
          request.id,
          ErrorCodes.METHOD_NOT_FOUND,
          `Tool '${toolName}' not found in any server. Available tools: ${[...this.toolToServer.keys()].join(", ")}`,
        ),
      );
      return;
    }

    const server = this.servers.get(serverName)!;
    const config = server.entry.resolveToolConfig(toolName);

    const ctx: MiddlewareContext = {
      request,
      toolName,
      serverName,
      config,
      attempt: 1,
      startTime: Date.now(),
    };

    try {
      const response = await server.entry.middleware(ctx, () =>
        this.sendToServerAndWait(serverName, request),
      );
      // Ensure the response ID matches the original request
      this.sendToAgent({ ...response, id: request.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendToAgent(makeErrorResponse(request.id, -32000, `Middleware error: ${message}`));
    }
  }

  private handleServerMessage(serverName: string, msg: JsonRpcMessage): void {
    const server = this.servers.get(serverName);
    if (!server) return;

    if (isResponse(msg) && server.pendingRequests.has(msg.id)) {
      const pending = server.pendingRequests.get(msg.id)!;
      server.pendingRequests.delete(msg.id);
      pending.resolve(msg);
    }
    // Drop other server messages (notifications etc.)
  }

  private sendToServerAndWait(serverName: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const server = this.servers.get(serverName);
    if (!server) {
      return Promise.resolve(
        makeErrorResponse(request.id, ErrorCodes.SERVER_CRASH, `Server '${serverName}' not found`),
      );
    }

    return new Promise((resolve) => {
      server.pendingRequests.set(request.id, { resolve });
      this.sendToServer(serverName, request);
    });
  }

  private sendToServer(serverName: string, msg: JsonRpcMessage): void {
    const server = this.servers.get(serverName);
    if (server?.child.stdin?.writable) {
      server.child.stdin.write(encodeMessage(msg));
    }
  }

  private sendToAgent(msg: JsonRpcMessage): void {
    process.stdout.write(encodeMessage(msg));
  }

  stop(): void {
    for (const server of this.servers.values()) {
      if (!server.child.killed) {
        server.child.kill("SIGTERM");
      }
    }
  }

  /** Get the tool→server routing map (for testing/inspection). */
  getToolRouting(): ReadonlyMap<string, string> {
    return this.toolToServer;
  }
}
