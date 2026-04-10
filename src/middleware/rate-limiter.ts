import type { MiddlewareFn } from "./types.js";
import { makeErrorResponse, ErrorCodes } from "../proxy/types.js";

export interface RateLimitConfig {
  /** Maximum number of calls allowed within the window. */
  max_calls: number;
  /** Time window in milliseconds. */
  window: number;
}

interface BucketEntry {
  timestamps: number[];
}

/**
 * Sliding window rate limiter.
 * Tracks call timestamps per tool and rejects when limit is exceeded.
 */
export class RateLimiter {
  private buckets = new Map<string, BucketEntry>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if a call is allowed and record it if so.
   * Returns { allowed: true } or { allowed: false, retryAfter: ms }.
   */
  check(key: string): { allowed: true } | { allowed: false; retryAfter: number } {
    const now = Date.now();
    const windowStart = now - this.config.window;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // Evict timestamps outside the window
    bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

    if (bucket.timestamps.length >= this.config.max_calls) {
      // Calculate when the oldest call in window will expire
      const oldest = bucket.timestamps[0]!;
      const retryAfter = oldest + this.config.window - now;
      return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
    }

    bucket.timestamps.push(now);
    return { allowed: true };
  }

  /** Reset all rate limit state (for testing). */
  reset(): void {
    this.buckets.clear();
  }
}

export function createRateLimiterMiddleware(config: RateLimitConfig): MiddlewareFn {
  const limiter = new RateLimiter(config);

  const middleware: MiddlewareFn = async (ctx, next) => {
    const key = `${ctx.serverName}:${ctx.toolName}`;
    const result = limiter.check(key);

    if (!result.allowed) {
      return makeErrorResponse(
        ctx.request.id,
        ErrorCodes.RATE_LIMITED,
        `Rate limit exceeded for tool '${ctx.toolName}'. Try again in ${result.retryAfter}ms.`,
        {
          type: "rate_limited",
          tool: ctx.toolName,
          server: ctx.serverName,
          retry_after_ms: result.retryAfter,
          max_calls: config.max_calls,
          window_ms: config.window,
        },
      );
    }

    return next();
  };

  // Expose limiter for testing/inspection
  (middleware as MiddlewareFn & { limiter: RateLimiter }).limiter = limiter;

  return middleware;
}
