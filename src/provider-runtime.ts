/**
 * Effect runtime boundary for pi-agy-cli.
 * Guarantees one fiber per call and a single terminal event on pi's stream.
 */

import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { PiInputContext } from "./pi-context.ts";
import { Effect } from "effect";
import { makeProcessPool } from "./agy-process-pool.ts";
import { runEpisode } from "./episode.ts";
import { createEventBridge } from "./event-bridge.ts";
import type { ProviderSettings } from "./provider-env.ts";
import { endStreamWithError } from "./terminal-event.ts";

export interface ProviderRuntime {
  readonly startEpisode: (
    stream: AssistantMessageEventStream,
    model: Model<Api>,
    context: PiInputContext,
    options?: SimpleStreamOptions,
  ) => void;
  readonly shutdown: () => Promise<void>;
}

export function createProviderRuntime(settings: ProviderSettings): ProviderRuntime {
  const pool = makeProcessPool(settings.poolCap);

  const startEpisode: ProviderRuntime["startEpisode"] = (stream, model, context, options) => {
    const program = runEpisode({
      stream,
      model,
      context,
      options,
      settings,
      pool,
    }).pipe(
      Effect.catch((err) =>
        Effect.sync(() => {
          const stopReason = err._tag === "AgyAbortedError" ? "aborted" : "error";
          const message = err._tag === "AgyAbortedError" ? err.reason : err.message;
          endStreamWithError(
            stream,
            createEventBridge(stream, model).getOutput(),
            stopReason,
            message,
          );
        }),
      ),
    );

    void Effect.runPromise(program);
  };

  const shutdown = (): Promise<void> => Effect.runPromise(pool.shutdown());

  return { startEpisode, shutdown };
}
