import { describe, expect, it } from "vite-plus/test";
import { decideEpisodeMode } from "../src/episode-mode.ts";

describe("episode-mode", () => {
  it("spawns when no parked process exists", () => {
    expect(
      decideEpisodeMode({
        hasParkedProcess: false,
        signatureMatches: true,
        prefixMatches: true,
        pendingToolCallIds: [],
        incomingToolResultIds: [],
      }),
    ).toBe("spawn");
  });

  it("spawns when launch signature or history prefix mismatches", () => {
    expect(
      decideEpisodeMode({
        hasParkedProcess: true,
        signatureMatches: false,
        prefixMatches: true,
        pendingToolCallIds: [],
        incomingToolResultIds: [],
      }),
    ).toBe("spawn");

    expect(
      decideEpisodeMode({
        hasParkedProcess: true,
        signatureMatches: true,
        prefixMatches: false,
        pendingToolCallIds: [],
        incomingToolResultIds: [],
      }),
    ).toBe("spawn");
  });

  it("continues warm turn when parked process matches and no tool calls are pending", () => {
    expect(
      decideEpisodeMode({
        hasParkedProcess: true,
        signatureMatches: true,
        prefixMatches: true,
        pendingToolCallIds: [],
        incomingToolResultIds: [],
      }),
    ).toBe("turn");
  });

  it("selects handoff only when incoming tool results match pending calls exactly", () => {
    expect(
      decideEpisodeMode({
        hasParkedProcess: true,
        signatureMatches: true,
        prefixMatches: true,
        pendingToolCallIds: ["tc-1", "tc-2"],
        incomingToolResultIds: ["tc-2", "tc-1"],
      }),
    ).toBe("handoff");

    expect(
      decideEpisodeMode({
        hasParkedProcess: true,
        signatureMatches: true,
        prefixMatches: true,
        pendingToolCallIds: ["tc-1", "tc-2"],
        incomingToolResultIds: ["tc-1"],
      }),
    ).toBe("spawn");
  });
});
