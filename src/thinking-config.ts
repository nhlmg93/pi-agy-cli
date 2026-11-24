/**
 * Maps pi ThinkingLevel values to `agy --effort` flags.
 * Effect-free: imported eagerly by index.ts.
 */

import type { ThinkingLevel } from "@earendil-works/pi-ai";

export type AgyEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORT_MAP: Record<ThinkingLevel, AgyEffortLevel> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

export function mapThinkingEffort(reasoning?: ThinkingLevel): AgyEffortLevel | undefined {
  if (reasoning === undefined) return undefined;
  return EFFORT_MAP[reasoning];
}
