import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { describeCliAuthStatus, probeCliAuthStatus } from "../src/cli-auth.ts";

describe("cli-auth", () => {
  it("reports available when binary responds to --help", async () => {
    const stub = resolve("tests/e2e/agy-stub.cjs");
    const status = await probeCliAuthStatus(stub);
    expect(status.available).toBe(true);
    expect(describeCliAuthStatus(status)).toContain("ready");
  });

  it("reports unavailable when binary does not exist", async () => {
    const status = await probeCliAuthStatus("/nonexistent/agy-binary-xyz");
    expect(status.available).toBe(false);
    expect(describeCliAuthStatus(status)).toContain("not ready");
  });
});
