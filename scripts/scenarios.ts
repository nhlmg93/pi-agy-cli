#!/usr/bin/env node
/**
 * Deterministic stub scenario runner for pi-agy-cli.
 * Exercises Effect services against `tests/e2e/agy-stub.cjs` without spending tokens.
 */

import { runAllScenarios } from "./scenarios/driver.ts";

runAllScenarios().catch((err: unknown) => {
  console.error("[pi-agy-cli] scenario failed:", err);
  process.exit(1);
});
