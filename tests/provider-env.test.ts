import { describe, expect, it } from "vite-plus/test";
import { resolveProviderSettings } from "../src/provider-env.ts";

describe("provider-env", () => {
  it("returns defaults when env vars are unset", () => {
    expect(resolveProviderSettings({})).toEqual({
      binary: "agy",
      poolCap: 4,
      inactivityTimeoutMs: 180_000,
      traceWireRaw: false,
    });
  });

  it("reads valid overrides from PI_AGY_CLI_* env vars", () => {
    expect(
      resolveProviderSettings({
        PI_AGY_CLI_BIN: "/custom/agy",
        PI_AGY_CLI_POOL_CAP: "8",
        PI_AGY_CLI_TIMEOUT_MS: "45000",
        PI_AGY_CLI_TRACE_WIRE: "raw",
      }),
    ).toEqual({
      binary: "/custom/agy",
      poolCap: 8,
      inactivityTimeoutMs: 45_000,
      traceWireRaw: true,
    });
  });

  it("falls back to defaults on invalid or non-positive numbers", () => {
    expect(
      resolveProviderSettings({
        PI_AGY_CLI_POOL_CAP: "0",
        PI_AGY_CLI_TIMEOUT_MS: "not-a-number",
      }),
    ).toEqual({
      binary: "agy",
      poolCap: 4,
      inactivityTimeoutMs: 180_000,
      traceWireRaw: false,
    });
  });
});
