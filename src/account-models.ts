/**
 * Account model discovery and fallback catalog for pi-agy-cli.
 * Effect-free: imported eagerly by index.ts.
 */

import type { Api, Model } from "@earendil-works/pi-ai";

export type ProviderModel = Omit<Model<Api>, "api" | "provider" | "baseUrl">;

export interface AgyModelEntry {
  readonly id: string;
  readonly name: string;
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

export function toProviderModel(entry: AgyModelEntry): ProviderModel {
  return {
    id: entry.id,
    name: entry.name,
    reasoning: true,
    input: ["text", "image"],
    cost: { ...ZERO_COST },
    contextWindow: 200_000,
    maxTokens: 64_000,
  };
}

export function defaultFallbackModels(): readonly ProviderModel[] {
  return [
    toProviderModel({ id: "gemini-4-neon-high", name: "Gemini 4 Neon (High)" }),
    toProviderModel({ id: "gemini-4-neon-medium", name: "Gemini 4 Neon (Medium)" }),
    toProviderModel({ id: "gemini-4-neon-low", name: "Gemini 4 Neon (Low)" }),
  ];
}

export function createModelRefresh(hooks: ModelProbeHooks) {
  return async (signal?: AbortSignal): Promise<readonly ProviderModel[]> => {
    const discovered = await hooks.models(signal);
    if (discovered.length === 0) return defaultFallbackModels();
    return discovered.map(toProviderModel);
  };
}
