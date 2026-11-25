/**
 * Launch flags and environment construction for the `agy acp` subprocess.
 */

export interface AgyLaunchSpec {
  readonly binary: string;
  /** pi model id (agy model family); part of the warm-process launch signature. */
  readonly model: string;
  /** Concrete agy model id (effort variant) selected at launch. */
  readonly agyModelId: string;
  readonly cwd: string;
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
