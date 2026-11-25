/**
 * Account model discovery and fallback catalog for pi-agy-cli.
 * Effect-free: imported eagerly by index.ts.
 *
 * `agy models` lists one id per effort variant (`gemini-4-neon-high`). pi
 * gets one model per family (`gemini-4-neon`) and picks the variant from its
 * thinking level, so the model name and the effort never disagree.
 */

import type { Api, Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { AGY_THOUGHT_LEVELS, type AgyThoughtLevel } from "./thinking-config.ts";

export type ProviderModel = Omit<Model<Api>, "api" | "provider" | "baseUrl">;

export interface AgyModelEntry {
  readonly id: string;
  readonly name: string;
}

export interface AgyModelFamily {
  readonly id: string;
  readonly name: string;
  /** agy model id per thought level; empty when the model has no effort variants. */
  readonly variants: Partial<Record<AgyThoughtLevel, string>>;
}

export interface ModelProbeHooks {
  readonly models: (signal?: AbortSignal) => Promise<readonly AgyModelEntry[]>;
}

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

/**
 * Context windows as reported by `agy acp` `usage_update.size`. ACP reports
 * them only per live session, so they are kept here by vendor prefix.
 */
const CONTEXT_WINDOWS: readonly (readonly [prefix: string, tokens: number])[] = [
  ["gemini-", 1_048_576],
  ["claude-", 1_000_000],
  ["gpt-oss-", 131_072],
];
const DEFAULT_CONTEXT_WINDOW = 200_000;

const VARIANT_PATTERN = /^(.+)-(low|medium|high|xhigh)$/;
const VARIANT_NAME_PATTERN = /^(.+?)\s*\((low|medium|high|xhigh)\)$/i;

export function parseAgyModelsOutput(stdout: string): readonly AgyModelEntry[] {
  const entries: AgyModelEntry[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Fetching ")) continue;
    const [id, ...rest] = line.split("\t");
    if (!id) continue;
    const name = rest.join("\t").trim() || id;
    entries.push({ id: id.trim(), name });
  }
  return entries;
}

function isThoughtLevel(value: string): value is AgyThoughtLevel {
  return (AGY_THOUGHT_LEVELS as readonly string[]).includes(value);
}

/** Groups agy effort variants into families, in first-seen order. */
export function groupAgyModelFamilies(entries: readonly AgyModelEntry[]): readonly AgyModelFamily[] {
  const families = new Map<string, { name: string; variants: Partial<Record<AgyThoughtLevel, string>> }>();
  for (const entry of entries) {
    const idMatch = VARIANT_PATTERN.exec(entry.id);
    const nameMatch = VARIANT_NAME_PATTERN.exec(entry.name);
    const level = idMatch?.[2];
    if (idMatch && nameMatch && level && isThoughtLevel(level) && nameMatch[2]?.toLowerCase() === level) {
      const familyId = idMatch[1]!;
      const family = families.get(familyId) ?? { name: nameMatch[1]!.trim(), variants: {} };
      family.variants[level] = entry.id;
      families.set(familyId, family);
    } else if (!families.has(entry.id)) {
      families.set(entry.id, { name: entry.name, variants: {} });
    }
  }
  return [...families].map(([id, family]) => ({ id, name: family.name, variants: family.variants }));
}

export function contextWindowFor(familyId: string): number {
  for (const [prefix, tokens] of CONTEXT_WINDOWS) {
    if (familyId.startsWith(prefix)) return tokens;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

function thinkingLevelMapFor(family: AgyModelFamily): ThinkingLevelMap | undefined {
  if (Object.keys(family.variants).length === 0) return undefined;
  return {
    off: null,
    minimal: null,
    low: family.variants.low ?? null,
    medium: family.variants.medium ?? null,
    high: family.variants.high ?? null,
    xhigh: family.variants.xhigh ?? null,
    max: null,
  };
}

export function toProviderModel(family: AgyModelFamily): ProviderModel {
  const thinkingLevelMap = thinkingLevelMapFor(family);
  return {
    id: family.id,
    name: family.name,
    reasoning: thinkingLevelMap !== undefined,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    input: ["text", "image"],
    cost: { ...ZERO_COST },
    contextWindow: contextWindowFor(family.id),
    maxTokens: 64_000,
  };
}

export function defaultFallbackModels(): readonly ProviderModel[] {
  return groupAgyModelFamilies([
    { id: "gemini-4-neon-low", name: "Gemini 4 Neon (Low)" },
    { id: "gemini-4-neon-medium", name: "Gemini 4 Neon (Medium)" },
    { id: "gemini-4-neon-high", name: "Gemini 4 Neon (High)" },
    { id: "gemini-4-neon-xhigh", name: "Gemini 4 Neon (XHigh)" },
  ]).map(toProviderModel);
}

export function createModelRefresh(hooks: ModelProbeHooks) {
  return async (signal?: AbortSignal): Promise<readonly ProviderModel[]> => {
    const discovered = await hooks.models(signal);
    if (discovered.length === 0) return defaultFallbackModels();
    return groupAgyModelFamilies(discovered).map(toProviderModel);
  };
}
