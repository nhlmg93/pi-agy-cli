/**
 * Single terminal event helper for pi AssistantMessageEventStream.
 * Effect-free: imported eagerly by index.ts and src/provider-runtime.ts.
 */

import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";

export function endStreamWithError(
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  stopReason: "error" | "aborted",
  errorMessage: string,
): void {
  const finalMessage: AssistantMessage = {
    ...output,
    stopReason,
    errorMessage,
  };
  stream.push({ type: "error", reason: stopReason, error: finalMessage });
  stream.end();
}
