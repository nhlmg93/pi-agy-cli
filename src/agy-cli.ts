/**
 * Launch flags and environment construction for the `agy acp` subprocess.
 */

import type { AgyEffortLevel } from "./thinking-config.ts";

export interface AgyLaunchSpec {
  readonly binary: string;
  readonly model: string;
  readonly cwd: string;
  readonly effort?: AgyEffortLevel;
  readonly appDataDir?: string;
}

export function buildAgyArgs(spec: AgyLaunchSpec): readonly string[] {
  const args: string[] = ["acp", "--include-default-customizations=false"];

  if (spec.appDataDir) {
    args.push("--app-data-dir", spec.appDataDir);
  }

  return args;
}

export function buildAgyEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...baseEnv };
}
