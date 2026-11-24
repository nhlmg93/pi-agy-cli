import { describe, expect, it } from "vite-plus/test";
import { buildAgyArgs, buildAgyEnv } from "../src/agy-cli.ts";

describe("agy-cli", () => {
  it("builds ACP launch args without default customizations", () => {
    const args = buildAgyArgs({
      binary: "agy",
      model: "gemini-4-neon-high",
      cwd: "/tmp/work",
    });

    expect(args).toEqual(["acp", "--include-default-customizations=false"]);
  });

  it("appends optional --app-data-dir when provided", () => {
    const args = buildAgyArgs({
      binary: "agy",
      model: "gemini-4-neon-high",
      cwd: "/tmp/work",
      appDataDir: "/tmp/agy-ephemeral",
    });

    expect(args).toEqual([
      "acp",
      "--include-default-customizations=false",
      "--app-data-dir",
      "/tmp/agy-ephemeral",
    ]);
  });

  it("clones base environment without mutating it", () => {
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin", FOO: "bar" };
    const env = buildAgyEnv(base);
    expect(env).toEqual(base);
    expect(env).not.toBe(base);
  });
});
