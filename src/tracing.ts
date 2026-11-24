/**
 * Content-free NDJSON span sink for pi-agy-cli.
 * Records ids, names, counts, and durations — never prompt text or tool payloads.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Effect } from "effect";
import { traceFileForDate } from "./trace-location.ts";

export interface TraceSpan {
  readonly name: string;
  readonly durationMs: number;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export function recordSpan(span: TraceSpan): Effect.Effect<void> {
  return Effect.sync(() => {
    try {
      const file = traceFileForDate();
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const record = {
        ts: new Date().toISOString(),
        ...span,
      };
      appendFileSync(file, JSON.stringify(record) + "\n", { mode: 0o600 });
    } catch {
      // Tracing must never fail a model call.
    }
  });
}
