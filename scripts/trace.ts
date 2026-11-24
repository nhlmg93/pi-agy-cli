#!/usr/bin/env node
/**
 * Trace inspection CLI (`vp run trace -- stats|last`).
 */

import { existsSync, readFileSync } from "node:fs";
import { traceFileForDate } from "../src/trace-location.ts";

const command = process.argv[2] ?? "stats";
const file = traceFileForDate();

if (!existsSync(file)) {
  console.log(`No trace file found at ${file}`);
  process.exit(0);
}

const lines = readFileSync(file, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { ts: string; name: string; durationMs: number });

if (command === "last") {
  console.log(JSON.stringify(lines[lines.length - 1] ?? null, null, 2));
} else {
  const counts = new Map<string, { count: number; totalMs: number }>();
  for (const span of lines) {
    const prev = counts.get(span.name) ?? { count: 0, totalMs: 0 };
    counts.set(span.name, { count: prev.count + 1, totalMs: prev.totalMs + span.durationMs });
  }
  for (const [name, stat] of counts) {
    console.log(`${name}: ${stat.count} spans, avg ${(stat.totalMs / stat.count).toFixed(1)} ms`);
  }
}
