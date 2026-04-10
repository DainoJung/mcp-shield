import type { MiddlewareFn } from "./types.js";
import { ErrorCodes } from "../proxy/types.js";

const NON_RETRYABLE_CODES: ReadonlySet<number> = new Set([
  ErrorCodes.TIMEOUT,
  ErrorCodes.INVALID_PARAMS,
  ErrorCodes.METHOD_NOT_FOUND,
  ErrorCodes.CIRCUIT_OPEN,
]);

function computeDelay(
  attempt: number,
  backoff: "exponential" | "linear" | "fixed",
  baseDelay: number,
  maxDelay: number,
  jitter: boolean,
): number {
  let delay: number;

  switch (backoff) {
    case "exponential":
      delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
      break;
    case "linear":
      delay = Math.min(baseDelay * (attempt + 1), maxDelay);
      break;
    case "fixed":
      delay = baseDelay;
      break;
  }

  if (jitter) {
    delay = delay * (1 + Math.random() * 0.5);
  }

  return delay;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRetryMiddleware(): MiddlewareFn {
  return async (ctx, next) => {
    const { max, backoff, base_delay, max_delay, jitter } = ctx.config.retries;
    let lastResponse = await next();

    for (let attempt = 0; attempt < max; attempt++) {
      // Success — no retry needed
      if (!lastResponse.error) {
        return lastResponse;
      }

      // Non-retryable error — return immediately
      if (NON_RETRYABLE_CODES.has(lastResponse.error.code)) {
        return lastResponse;
      }

      const delay = computeDelay(attempt, backoff, base_delay, max_delay, jitter);
      await sleep(delay);

      ctx.attempt = attempt + 2; // 1-based, first try was attempt 1
      lastResponse = await next();
    }

    return lastResponse;
  };
}
