/**
 * Environment and settings resolution for pi-agy-cli.
 * Effect-free: imported eagerly by index.ts.
 */

export interface ProviderSettings {
  readonly binary: string;
  readonly poolCap: number;
  readonly inactivityTimeoutMs: number;
  readonly traceWireRaw: boolean;
}

export function resolveProviderSettings(env: NodeJS.ProcessEnv = process.env): ProviderSettings {
  const poolCap = Number.parseInt(env.PI_AGY_CLI_POOL_CAP ?? "4", 10);
  const timeoutMs = Number.parseInt(env.PI_AGY_CLI_TIMEOUT_MS ?? "180000", 10);

  return {
    binary: env.PI_AGY_CLI_BIN || "agy",
    poolCap: Number.isFinite(poolCap) && poolCap > 0 ? poolCap : 4,
    inactivityTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180_000,
    traceWireRaw: env.PI_AGY_CLI_TRACE_WIRE === "raw",
  };
}
