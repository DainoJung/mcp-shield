import type { MiddlewareFn } from "./types.js";
import type { JsonRpcResponse } from "../proxy/types.js";

/**
 * Validate that MCP tool responses conform to the expected schema.
 *
 * A valid tools/call response must have:
 *   result.content — an array of content blocks
 *   Each content block must have a `type` field (typically "text", "image", "resource")
 *
 * If validation fails, the original response is wrapped with a warning
 * but still returned (non-blocking by default).
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateToolResponse(response: JsonRpcResponse): ValidationResult {
  const errors: string[] = [];

  // Error responses are always valid (they follow JSON-RPC error format)
  if (response.error) {
    return { valid: true, errors };
  }

  if (!response.result) {
    errors.push("Response missing 'result' field");
    return { valid: false, errors };
  }

  const result = response.result as Record<string, unknown>;

  if (!result.content) {
    errors.push("Response missing 'result.content' field");
    return { valid: false, errors };
  }

  if (!Array.isArray(result.content)) {
    errors.push("'result.content' must be an array");
    return { valid: false, errors };
  }

  for (let i = 0; i < result.content.length; i++) {
    const block = result.content[i] as Record<string, unknown>;

    if (!block || typeof block !== "object") {
      errors.push(`content[${i}]: must be an object`);
      continue;
    }

    if (!block.type || typeof block.type !== "string") {
      errors.push(`content[${i}]: missing or invalid 'type' field`);
    }

    // Type-specific validation
    if (block.type === "text" && typeof block.text !== "string") {
      errors.push(`content[${i}]: text content block missing 'text' string field`);
    }

    if (block.type === "image") {
      if (typeof block.data !== "string") {
        errors.push(`content[${i}]: image content block missing 'data' string field`);
      }
      if (typeof block.mimeType !== "string") {
        errors.push(`content[${i}]: image content block missing 'mimeType' string field`);
      }
    }

    if (block.type === "resource") {
      if (!block.resource || typeof block.resource !== "object") {
        errors.push(`content[${i}]: resource content block missing 'resource' object`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export type ValidationMode = "warn" | "enforce";

export function createResponseValidatorMiddleware(
  mode: ValidationMode = "warn",
  onValidationError?: (toolName: string, errors: string[]) => void,
): MiddlewareFn {
  return async (ctx, next) => {
    const response = await next();

    const { valid, errors } = validateToolResponse(response);

    if (!valid) {
      onValidationError?.(ctx.toolName, errors);

      if (mode === "enforce") {
        return {
          jsonrpc: "2.0",
          id: response.id,
          error: {
            code: -32006,
            message: `Response validation failed for tool '${ctx.toolName}': ${errors.join("; ")}`,
            data: { type: "validation_error", tool: ctx.toolName, errors },
          },
        };
      }
      // "warn" mode: return original response (logged by caller)
    }

    return response;
  };
}
