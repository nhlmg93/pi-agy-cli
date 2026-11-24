/**
 * Lazy Effect-backed probe for `agy models`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseAgyModelsOutput, type AgyModelEntry } from "./account-models.ts";

const execFileAsync = promisify(execFile);

export async function probeAccountModels(
  signal?: AbortSignal,
  binary = "agy",
): Promise<readonly AgyModelEntry[]> {
  try {
    const { stdout } = await execFileAsync(binary, ["models"], {
      timeout: 10_000,
      signal,
    });
    return parseAgyModelsOutput(stdout);
  } catch {
    return [];
  }
}
