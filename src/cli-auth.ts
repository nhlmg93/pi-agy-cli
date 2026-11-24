/**
 * Disk-cached / lightweight Antigravity CLI availability probe.
 * Effect-free: imported eagerly by index.ts.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CliAuthStatus {
  readonly available: boolean;
  readonly binary: string;
  readonly detail: string;
}

export async function probeCliAuthStatus(binary = "agy"): Promise<CliAuthStatus> {
  try {
    const { stdout } = await execFileAsync(binary, ["--help"], { timeout: 5_000 });
    return {
      available: stdout.length > 0,
      binary,
      detail: `${binary} CLI is available on PATH.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      binary,
      detail: `${binary} CLI unavailable: ${message}`,
    };
  }
}

export function describeCliAuthStatus(status: CliAuthStatus): string {
  return status.available
    ? `pi-agy-cli: ready (${status.detail})`
    : `pi-agy-cli: not ready (${status.detail})`;
}
