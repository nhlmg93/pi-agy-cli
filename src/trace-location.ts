/**
 * Resolves the state directory and daily NDJSON trace file path for pi-agy-cli.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export function defaultTraceDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateHome = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(stateHome, "pi-agy-cli", "traces");
}

export function traceFileForDate(date = new Date(), env: NodeJS.ProcessEnv = process.env): string {
  const day = date.toISOString().slice(0, 10);
  return join(defaultTraceDir(env), `${day}.ndjson`);
}
