/**
 * Resolves pi's thinking level to the concrete `agy` model variant.
 * Effect-free: imported eagerly by index.ts.
 *
 * agy encodes reasoning effort in the model id (`gemini-4-neon-high`); its
 * ACP `thought_level` option is just a view of that variant. pi models are
 * agy model families (`gemini-4-neon`) whose `thinkingLevelMap` maps each
 * supported pi level to the variant id, so the model pi shows and the effort
 * pi shows are always the pair agy runs.
 */

import type { ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";

export const AGY_THOUGHT_LEVELS = ["low", "medium", "high", "xhigh"] as const;
export type AgyThoughtLevel = (typeof AGY_THOUGHT_LEVELS)[number];

/** pi levels from lowest to highest, as pi clamps them. */
const PI_LEVEL_ORDER: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface AgyModelRoute {
  readonly id: string;
  readonly thinkingLevelMap?: ThinkingLevelMap;
}

/**
 * Returns the agy model id to run for a pi model (family) and pi thinking level.
 * Mirrors pi's clamping: the requested level, else the nearest higher, else the
 * nearest lower supported level. No level means the lowest supported variant.
 * Families without variants run under their own id.
 */
export function resolveAgyModelId(model: AgyModelRoute, reasoning?: ThinkingLevel): string {
  const map = model.thinkingLevelMap;
  if (!map) return model.id;
  const requested = reasoning === undefined ? 0 : PI_LEVEL_ORDER.indexOf(reasoning);
  const start = requested < 0 ? 0 : requested;
  for (let i = start; i < PI_LEVEL_ORDER.length; i++) {
    const variant = map[PI_LEVEL_ORDER[i]!];
    if (typeof variant === "string") return variant;
  }
  for (let i = start - 1; i >= 0; i--) {
    const variant = map[PI_LEVEL_ORDER[i]!];
    if (typeof variant === "string") return variant;
  }
  return model.id;
}
