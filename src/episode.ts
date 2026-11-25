/**
 * Episode orchestration: one pi model call over `agy acp`.
 *
 * - `spawn`: launch fresh `agy acp` + loopback MCP server, import pi history
 * - `turn`: reuse warm parked `agy acp` process for the next user message
 * - `handoff`: answer held-open MCP `tools/call` requests with pi's tool results
 *   and resume streaming the in-flight `session/prompt`
 */

import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { Effect } from "effect";
import type { AcpPromptOutcome, AcpSessionUpdate } from "./agy-process.ts";
import type { ParkedProcess, ProcessPool } from "./agy-process-pool.ts";
import { decideEpisodeMode } from "./episode-mode.ts";
import { AgyAbortedError, AgyProcessError } from "./errors.ts";
import { createEventBridge } from "./event-bridge.ts";
import type { HeldToolCall } from "./mcp-inband.ts";
import {
  buildAcpPromptBlocks,
  extractTrailingToolResults,
  resolvePiRequest,
  type PiInputContext,
} from "./pi-context.ts";
import type { ProviderSettings } from "./provider-env.ts";
import { resolveAgyModelId } from "./thinking-config.ts";
import { recordSpan } from "./tracing.ts";

/** Brief window to coalesce simultaneous parallel MCP `tools/call` invocations. */
const TOOL_BATCH_WINDOW_MS = 25;

export interface EpisodeRequest {
  readonly stream: AssistantMessageEventStream;
  readonly model: Model<Api>;
  readonly context: PiInputContext;
  readonly options?: SimpleStreamOptions;
  readonly settings: ProviderSettings;
  readonly pool: ProcessPool;
}

function extractChunkText(update: AcpSessionUpdate): string | undefined {
  const content = update.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return undefined;
  const obj = content as Record<string, unknown>;
  if (obj.type === "text" && typeof obj.text === "string") return obj.text;
  return undefined;
}

export function runEpisode(
  request: EpisodeRequest,
): Effect.Effect<void, AgyProcessError | AgyAbortedError> {
  return Effect.gen(function* () {
    const startMs = Date.now();
    const sessionKey = request.options?.sessionId ?? "default";
    const cwd = process.cwd();
    const agyModelId = resolveAgyModelId(request.model, request.options?.reasoning);
    const resolved = resolvePiRequest(request.context);
    const tools = resolved.tools;
    const incomingToolResults = extractTrailingToolResults(request.context);

    const parked = yield* request.pool.take(sessionKey);
    const mode = decideEpisodeMode({
      hasParkedProcess: parked !== undefined,
      signatureMatches:
        parked !== undefined &&
        parked.handle.spec.model === request.model.id &&
        parked.handle.spec.cwd === cwd,
      prefixMatches:
        parked !== undefined && parked.acknowledgedPrefixLength <= resolved.messages.length,
      pendingToolCallIds: parked?.pendingToolCallIds ?? [],
      incomingToolResultIds: incomingToolResults.map((r) => r.toolCallId),
    });

    let active: ParkedProcess;
    let pendingBlocks: ReturnType<typeof buildAcpPromptBlocks> | undefined;
    let existingPromptPromise: Promise<AcpPromptOutcome> | undefined;

    if (mode === "spawn" || !parked) {
      if (parked) {
        yield* request.pool.retireInBackground(parked);
      }
      active = yield* request.pool.launch(
        {
          binary: request.settings.binary,
          model: request.model.id,
          agyModelId,
          cwd,
        },
        tools,
      );
      pendingBlocks = buildAcpPromptBlocks(request.context, "spawn");
    } else if (mode === "handoff" && parked.activePrompt) {
      active = parked;
      active.handle.mcp.setTools(tools);
      existingPromptPromise = parked.activePrompt;
    } else {
      active = parked;
      active.handle.mcp.setTools(tools);
      if (agyModelId !== parked.currentAgyModelId) {
        yield* Effect.tryPromise({
          try: () => active.handle.setModel(agyModelId),
          catch: (err) =>
            err instanceof AgyProcessError
              ? err
              : new AgyProcessError({ message: err instanceof Error ? err.message : String(err) }),
        }).pipe(Effect.tapError(() => request.pool.retireInBackground(active)));
        active = { ...active, currentAgyModelId: agyModelId };
      }
      pendingBlocks = buildAcpPromptBlocks(request.context, "turn");
    }

    const bridge = createEventBridge(request.stream, request.model);

    /**
     * Reports the context agy holds now. `session/prompt` usage sums every model
     * call of a prompt (which spans all of pi's tool round trips), so it is used
     * only when agy sent no `usage_update`.
     */
    const emitUsage = (outcome?: AcpPromptOutcome): void => {
      const context = active.handle.getContextUsage();
      if (context) {
        bridge.handleEvent({
          type: "usage",
          input: context.used,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: context.used,
        });
      } else if (outcome?.usage) {
        bridge.handleEvent({
          type: "usage",
          input: outcome.usage.inputTokens,
          output: outcome.usage.outputTokens,
          cacheRead: outcome.usage.cachedReadTokens,
          cacheWrite: outcome.usage.cachedWriteTokens,
          totalTokens: outcome.usage.totalTokens,
        });
      }
    };
    let promptPromise: Promise<AcpPromptOutcome> | undefined = existingPromptPromise;

    const episodeOutcome = yield* Effect.callback<
      | { readonly kind: "completed" }
      | { readonly kind: "handoff"; readonly toolIds: readonly string[] },
      AgyProcessError | AgyAbortedError
    >((resume) => {
      let settled = false;
      const heldCalls: HeldToolCall[] = [];
      let batchTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanupListeners = (): void => {
        if (batchTimer) {
          clearTimeout(batchTimer);
          batchTimer = undefined;
        }
        active.handle.setUpdateListener(undefined);
        active.handle.setExitListener(undefined);
        active.handle.mcp.setOnToolCall(undefined);
        if (abortHandler && request.options?.signal) {
          request.options.signal.removeEventListener("abort", abortHandler);
        }
      };

      const finish = (
        effect: Effect.Effect<
          | { readonly kind: "completed" }
          | { readonly kind: "handoff"; readonly toolIds: readonly string[] },
          AgyProcessError | AgyAbortedError
        >,
      ): void => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        resume(effect);
      };

      const flushToolCalls = (): void => {
        if (settled || heldCalls.length === 0) return;
        for (const call of heldCalls) {
          bridge.handleEvent({
            type: "tool_call",
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          });
        }
        emitUsage();
        bridge.handleEvent({ type: "done", stopReason: "toolUse" });
        finish(Effect.succeed({ kind: "handoff", toolIds: heldCalls.map((c) => c.id) }));
      };

      const abortHandler = (): void => {
        active.handle.cancelPrompt();
        finish(Effect.fail(new AgyAbortedError({ reason: "Request aborted" })));
      };

      if (request.options?.signal) {
        if (request.options.signal.aborted) {
          abortHandler();
          return;
        }
        request.options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      active.handle.setExitListener((err) => {
        finish(Effect.fail(err));
      });

      active.handle.setUpdateListener((update) => {
        if (settled) return;
        const kind = update.sessionUpdate;
        if (kind === "agent_message_chunk") {
          const text = extractChunkText(update);
          if (text) bridge.handleEvent({ type: "text_delta", text });
        } else if (kind === "agent_thought_chunk") {
          const thinking = extractChunkText(update);
          if (thinking) bridge.handleEvent({ type: "thinking_delta", thinking });
        }
      });

      active.handle.mcp.setOnToolCall((call) => {
        if (settled) return;
        heldCalls.push(call);
        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = setTimeout(flushToolCalls, TOOL_BATCH_WINDOW_MS);
      });

      // Listeners are now attached — start prompt or resolve held tool calls!
      if (mode === "handoff") {
        for (const result of incomingToolResults) {
          active.handle.mcp.resolveToolCall(result.toolCallId, result.text, result.isError);
        }
      } else if (pendingBlocks) {
        promptPromise = active.handle.startPrompt(pendingBlocks);
      }

      const activePromise = promptPromise;
      if (!activePromise) {
        finish(Effect.fail(new AgyProcessError({ message: "Missing in-flight ACP prompt" })));
        return;
      }

      void activePromise
        .then((outcome) => {
          if (settled) return;
          if (heldCalls.length > 0) {
            flushToolCalls();
            return;
          }
          emitUsage(outcome);
          bridge.handleEvent({ type: "done", stopReason: outcome.stopReason });
          finish(Effect.succeed({ kind: "completed" }));
        })
        .catch((err: unknown) => {
          const procErr =
            err instanceof AgyProcessError
              ? err
              : new AgyProcessError({
                  message: err instanceof Error ? err.message : String(err),
                  stderr: active.handle.getStderr(),
                });
          finish(Effect.fail(procErr));
        });
    }).pipe(Effect.tapError(() => request.pool.retireInBackground(active)));

    if (episodeOutcome.kind === "handoff") {
      yield* request.pool.park(sessionKey, {
        ...active,
        // Expect the assistant toolCall message + N toolResult messages on next call.
        acknowledgedPrefixLength: resolved.messages.length + 1,
        pendingToolCallIds: episodeOutcome.toolIds,
        activePrompt: promptPromise,
      });
    } else {
      yield* request.pool.park(sessionKey, {
        ...active,
        acknowledgedPrefixLength: resolved.messages.length,
        pendingToolCallIds: [],
        activePrompt: undefined,
      });
    }

    yield* recordSpan({
      name: "episode",
      durationMs: Date.now() - startMs,
      attributes: {
        mode,
        model: request.model.id,
        agyModel: active.currentAgyModelId,
        outcome: episodeOutcome.kind,
      },
    });
  });
}
