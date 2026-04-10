import type { MiddlewareFn } from "./types.js";
import { makeErrorResponse, ErrorCodes } from "../proxy/types.js";

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureTime: number;
}

/** Per-server circuit breaker state store. */
const serverStates = new Map<string, CircuitBreakerState>();

function getState(serverName: string): CircuitBreakerState {
  let state = serverStates.get(serverName);
  if (!state) {
    state = { state: "closed", failures: 0, lastFailureTime: 0 };
    serverStates.set(serverName, state);
  }
  return state;
}

/** Reset all circuit breaker state (for testing). */
export function resetAllCircuitBreakers(): void {
  serverStates.clear();
}

/** Get current circuit state for a server (for testing/inspection). */
export function getCircuitState(serverName: string): CircuitState {
  return getState(serverName).state;
}

export interface CircuitBreakerEvents {
  onStateChange?: (serverName: string, from: CircuitState, to: CircuitState, failures: number) => void;
}

export function createCircuitBreakerMiddleware(events?: CircuitBreakerEvents): MiddlewareFn {
  return async (ctx, next) => {
    const { threshold, reset_after } = ctx.config.circuit_breaker;
    const cbState = getState(ctx.serverName);

    // Check if circuit is open
    if (cbState.state === "open") {
      const elapsed = Date.now() - cbState.lastFailureTime;
      if (elapsed >= reset_after) {
        // Transition to half-open
        transition(cbState, "half-open", ctx.serverName, events);
      } else {
        return makeErrorResponse(
          ctx.request.id,
          ErrorCodes.CIRCUIT_OPEN,
          `Circuit breaker OPEN for server '${ctx.serverName}'. Retry after ${reset_after}ms.`,
          {
            type: "circuit_breaker",
            server: ctx.serverName,
            state: "open",
            failures: cbState.failures,
            reset_after_ms: reset_after,
          },
        );
      }
    }

    const response = await next();

    if (response.error) {
      cbState.failures++;
      cbState.lastFailureTime = Date.now();

      if (cbState.state === "half-open") {
        // Half-open failure → back to open
        transition(cbState, "open", ctx.serverName, events);
      } else if (cbState.failures >= threshold) {
        // Threshold reached → open
        transition(cbState, "open", ctx.serverName, events);
      }
    } else {
      // Success
      if (cbState.state === "half-open") {
        // Half-open success → closed
        cbState.failures = 0;
        transition(cbState, "closed", ctx.serverName, events);
      } else {
        // Reset consecutive failure count on success
        cbState.failures = 0;
      }
    }

    return response;
  };
}

function transition(
  state: CircuitBreakerState,
  to: CircuitState,
  serverName: string,
  events?: CircuitBreakerEvents,
): void {
  const from = state.state;
  state.state = to;
  events?.onStateChange?.(serverName, from, to, state.failures);
}
