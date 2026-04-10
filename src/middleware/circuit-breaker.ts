import type { MiddlewareFn } from "./types.js";
import { makeErrorResponse, ErrorCodes } from "../proxy/types.js";

export type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerEntry {
  state: CircuitState;
  failures: number;
  lastFailureTime: number;
}

export interface CircuitBreakerEvents {
  onStateChange?: (serverName: string, from: CircuitState, to: CircuitState, failures: number) => void;
}

/**
 * Instance-scoped circuit breaker state store.
 * Each call to createCircuitBreakerMiddleware gets its own isolated state.
 */
export class CircuitBreakerStore {
  private states = new Map<string, CircuitBreakerEntry>();

  get(serverName: string): CircuitBreakerEntry {
    let entry = this.states.get(serverName);
    if (!entry) {
      entry = { state: "closed", failures: 0, lastFailureTime: 0 };
      this.states.set(serverName, entry);
    }
    return entry;
  }

  getState(serverName: string): CircuitState {
    return this.get(serverName).state;
  }

  reset(): void {
    this.states.clear();
  }
}

export function createCircuitBreakerMiddleware(
  events?: CircuitBreakerEvents,
  store?: CircuitBreakerStore,
): MiddlewareFn & { store: CircuitBreakerStore } {
  const cbStore = store ?? new CircuitBreakerStore();

  const middleware: MiddlewareFn = async (ctx, next) => {
    const { threshold, reset_after } = ctx.config.circuit_breaker;
    const entry = cbStore.get(ctx.serverName);

    if (entry.state === "open") {
      const elapsed = Date.now() - entry.lastFailureTime;
      if (elapsed >= reset_after) {
        transition(entry, "half-open", ctx.serverName, events);
      } else {
        return makeErrorResponse(
          ctx.request.id,
          ErrorCodes.CIRCUIT_OPEN,
          `Circuit breaker OPEN for server '${ctx.serverName}'. Retry after ${reset_after}ms.`,
          {
            type: "circuit_breaker",
            server: ctx.serverName,
            state: "open",
            failures: entry.failures,
            reset_after_ms: reset_after,
          },
        );
      }
    }

    const response = await next();

    if (response.error) {
      entry.failures++;
      entry.lastFailureTime = Date.now();

      if (entry.state === "half-open") {
        transition(entry, "open", ctx.serverName, events);
      } else if (entry.failures >= threshold) {
        transition(entry, "open", ctx.serverName, events);
      }
    } else {
      if (entry.state === "half-open") {
        entry.failures = 0;
        transition(entry, "closed", ctx.serverName, events);
      } else {
        entry.failures = 0;
      }
    }

    return response;
  };

  return Object.assign(middleware, { store: cbStore });
}

function transition(
  entry: CircuitBreakerEntry,
  to: CircuitState,
  serverName: string,
  events?: CircuitBreakerEvents,
): void {
  const from = entry.state;
  entry.state = to;
  events?.onStateChange?.(serverName, from, to, entry.failures);
}

// Backwards-compatible helpers that use a shared default store
const defaultStore = new CircuitBreakerStore();

/** @deprecated Use CircuitBreakerStore instance instead */
export function resetAllCircuitBreakers(): void {
  defaultStore.reset();
}

/** @deprecated Use CircuitBreakerStore instance instead */
export function getCircuitState(serverName: string): CircuitState {
  return defaultStore.getState(serverName);
}
