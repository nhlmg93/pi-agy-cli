import { describe, expect, it } from "vite-plus/test";
import { mapThinkingEffort } from "../src/thinking-config.ts";

describe("thinking-config", () => {
  it("returns undefined when reasoning is undefined", () => {
    expect(mapThinkingEffort(undefined)).toBeUndefined();
  });

  it("maps pi ThinkingLevel values to agy --effort levels", () => {
    expect(mapThinkingEffort("minimal")).toBe("low");
    expect(mapThinkingEffort("low")).toBe("low");
    expect(mapThinkingEffort("medium")).toBe("medium");
    expect(mapThinkingEffort("high")).toBe("high");
    expect(mapThinkingEffort("xhigh")).toBe("xhigh");
  });
});
