import { z } from "zod";

/**
 * Parse human-readable duration strings to milliseconds.
 * Supports: "30s", "1m", "500ms", "1.5s"
 */
export function parseDuration(input: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m)$/.exec(input.trim());
  if (!match) {
    throw new Error(
      `Invalid duration '${input}'. Use format like '30s', '1m', or '500ms'.`,
    );
  }

  const value = parseFloat(match[1]!);
  const unit = match[2]!;

  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1_000;
    case "m":
      return value * 60_000;
    default:
      throw new Error(`Unknown duration unit '${unit}'`);
  }
}

/** Zod transform: accept number (ms) or duration string */
const durationSchema = z.union([
  z.number().positive(),
  z.string().transform((val) => parseDuration(val)),
]);

const retryConfigSchema = z.object({
  max: z.number().int().min(0).optional(),
  backoff: z.enum(["exponential", "linear", "fixed"]).optional(),
  base_delay: durationSchema.optional(),
  max_delay: durationSchema.optional(),
  jitter: z.boolean().optional(),
}).optional();

const circuitBreakerConfigSchema = z.object({
  threshold: z.number().int().positive().optional(),
  reset_after: durationSchema.optional(),
}).optional();

const loggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  format: z.enum(["json", "pretty"]).optional(),
}).optional();

const toolOverrideSchema = z.object({
  timeout: durationSchema.optional(),
  retries: retryConfigSchema,
}).strict();

const toolFilterSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
}).optional();

const serverConfigSchema = z.object({
  command: z.string().min(1, "Server command is required"),
  env: z.record(z.string()).optional(),
  timeout: durationSchema.optional(),
  retries: retryConfigSchema,
  circuit_breaker: circuitBreakerConfigSchema,
  logging: loggingConfigSchema,
  tools: z.record(toolOverrideSchema).optional(),
  tool_filter: toolFilterSchema,
});

export const configSchema = z.object({
  defaults: z.object({
    timeout: durationSchema.optional(),
    retries: retryConfigSchema,
    circuit_breaker: circuitBreakerConfigSchema,
    logging: loggingConfigSchema,
  }).optional(),
  servers: z.record(serverConfigSchema),
});

export type RawConfig = z.infer<typeof configSchema>;
export type RawServerConfig = z.infer<typeof serverConfigSchema>;
export type RawToolOverride = z.infer<typeof toolOverrideSchema>;
