/**
 * Pure episode mode decision: turn | handoff | spawn.
 */

export type EpisodeMode = "turn" | "handoff" | "spawn";

export interface EpisodeDecisionInput {
  readonly hasParkedProcess: boolean;
  readonly signatureMatches: boolean;
  readonly prefixMatches: boolean;
  readonly pendingToolCallIds: readonly string[];
  readonly incomingToolResultIds: readonly string[];
}

export function decideEpisodeMode(input: EpisodeDecisionInput): EpisodeMode {
  if (!input.hasParkedProcess || !input.signatureMatches || !input.prefixMatches) {
    return "spawn";
  }

  if (input.pendingToolCallIds.length > 0) {
    const expected = new Set(input.pendingToolCallIds);
    const matchesExactly =
      input.incomingToolResultIds.length === expected.size &&
      input.incomingToolResultIds.every((id) => expected.has(id));
    return matchesExactly ? "handoff" : "spawn";
  }

  return "turn";
}
