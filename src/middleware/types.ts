import type { JsonRpcRequest, JsonRpcResponse } from "../proxy/types.js";
import type { ResolvedToolConfig } from "../config/defaults.js";

export interface MiddlewareContext {
  request: JsonRpcRequest;
  toolName: string;
  serverName: string;
  config: ResolvedToolConfig;
  attempt: number;
  startTime: number;
}

export type NextFn = () => Promise<JsonRpcResponse>;

export type MiddlewareFn = (
  ctx: MiddlewareContext,
  next: NextFn,
) => Promise<JsonRpcResponse>;
