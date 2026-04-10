export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "method" in msg && "id" in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return ("result" in msg || "error" in msg) && "id" in msg && !("method" in msg);
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg);
}

export function isToolsCall(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return isRequest(msg) && msg.method === "tools/call";
}

export function makeErrorResponse(
  id: number | string,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  };
}

export const ErrorCodes = {
  TIMEOUT: -32001,
  CIRCUIT_OPEN: -32002,
  MAX_RETRIES: -32003,
  SERVER_CRASH: -32004,
  CONFIG_ERROR: -32005,
  VALIDATION_ERROR: -32006,
  RATE_LIMITED: -32007,
  TOOL_BLOCKED: -32008,
  INVALID_PARAMS: -32602,
  METHOD_NOT_FOUND: -32601,
} as const;
