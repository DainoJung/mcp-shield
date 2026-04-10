export interface ResolvedToolConfig {
  timeout: number;
  retries: {
    max: number;
    backoff: "exponential" | "linear" | "fixed";
    base_delay: number;
    max_delay: number;
    jitter: boolean;
  };
  circuit_breaker: {
    threshold: number;
    reset_after: number;
  };
  logging: {
    level: string;
    format: "json" | "pretty";
  };
}

export const BUILT_IN_DEFAULTS: ResolvedToolConfig = {
  timeout: 30_000,
  retries: {
    max: 2,
    backoff: "exponential",
    base_delay: 1_000,
    max_delay: 30_000,
    jitter: true,
  },
  circuit_breaker: {
    threshold: 5,
    reset_after: 60_000,
  },
  logging: {
    level: "info",
    format: "json",
  },
};

/**
 * Deep merge configs with higher priority winning.
 * Only defined (non-undefined) values override.
 */
export function mergeConfigs(
  ...configs: Partial<ResolvedToolConfig>[]
): ResolvedToolConfig {
  const result = structuredClone(BUILT_IN_DEFAULTS);

  for (const cfg of configs) {
    if (cfg.timeout !== undefined) result.timeout = cfg.timeout;
    if (cfg.retries) {
      if (cfg.retries.max !== undefined) result.retries.max = cfg.retries.max;
      if (cfg.retries.backoff !== undefined) result.retries.backoff = cfg.retries.backoff;
      if (cfg.retries.base_delay !== undefined) result.retries.base_delay = cfg.retries.base_delay;
      if (cfg.retries.max_delay !== undefined) result.retries.max_delay = cfg.retries.max_delay;
      if (cfg.retries.jitter !== undefined) result.retries.jitter = cfg.retries.jitter;
    }
    if (cfg.circuit_breaker) {
      if (cfg.circuit_breaker.threshold !== undefined)
        result.circuit_breaker.threshold = cfg.circuit_breaker.threshold;
      if (cfg.circuit_breaker.reset_after !== undefined)
        result.circuit_breaker.reset_after = cfg.circuit_breaker.reset_after;
    }
    if (cfg.logging) {
      if (cfg.logging.level !== undefined) result.logging.level = cfg.logging.level;
      if (cfg.logging.format !== undefined) result.logging.format = cfg.logging.format;
    }
  }

  return result;
}
