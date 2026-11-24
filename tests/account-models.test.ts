import { describe, expect, it } from "vite-plus/test";
import {
  createModelRefresh,
  defaultFallbackModels,
  parseAgyModelsOutput,
  toProviderModel,
} from "../src/account-models.ts";

describe("account-models", () => {
  it("parses tab-separated agy models output and skips header lines", () => {
    const stdout = [
      "Fetching available models...",
      "gemini-4-neon-high\tGemini 4 Neon (High)",
      "gemini-4-neon-low\tGemini 4 Neon (Low)",
      "solo-model-id",
      "",
    ].join("\n");

    expect(parseAgyModelsOutput(stdout)).toEqual([
      { id: "gemini-4-neon-high", name: "Gemini 4 Neon (High)" },
      { id: "gemini-4-neon-low", name: "Gemini 4 Neon (Low)" },
      { id: "solo-model-id", name: "solo-model-id" },
    ]);
  });

  it("maps an AgyModelEntry to a ProviderModel with zero subscription cost", () => {
    const model = toProviderModel({ id: "gemini-4-neon-high", name: "Gemini 4 Neon (High)" });
    expect(model.id).toBe("gemini-4-neon-high");
    expect(model.name).toBe("Gemini 4 Neon (High)");
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("returns discovered models when probe succeeds and falls back when empty", async () => {
    const refreshWithModels = createModelRefresh({
      models: async () => [{ id: "m1", name: "Model 1" }],
    });
    const discovered = await refreshWithModels();
    expect(discovered.map((m) => m.id)).toEqual(["m1"]);

    const refreshEmpty = createModelRefresh({
      models: async () => [],
    });
    const fallback = await refreshEmpty();
    expect(fallback).toEqual(defaultFallbackModels());
  });
});
