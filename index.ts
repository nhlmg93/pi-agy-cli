/**
 * Pi extension entry point for pi-agy-cli.
 *
 * Registers the `pi-agy-cli` provider, which serves pi model calls through
 * the Antigravity CLI (`agy`). pi owns the prompt, tools, and conversation.
 *
 * This file MUST stay free of Effect imports. The provider's Effect runtime
 * is loaded lazily on the first model call.
 */

import {
  type Api,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createModelRefresh,
  defaultFallbackModels,
  type ProviderModel,
} from "./src/account-models.ts";
import { describeCliAuthStatus, probeCliAuthStatus } from "./src/cli-auth.ts";
import { createEventBridge } from "./src/event-bridge.ts";
import { resolveProviderSettings } from "./src/provider-env.ts";
import type { ProviderRuntime } from "./src/provider-runtime.ts";
import { endStreamWithError } from "./src/terminal-event.ts";

export const PROVIDER_ID = "pi-agy-cli";

const piModel = (model: ProviderModel): Model<Api> => ({
  ...model,
  api: PROVIDER_ID,
  provider: PROVIDER_ID,
  baseUrl: PROVIDER_ID,
});

let runtimePromise: Promise<ProviderRuntime> | undefined;

async function loadRuntime(): Promise<ProviderRuntime> {
  if (!runtimePromise) {
    runtimePromise = import("./src/provider-runtime.ts").then((m) =>
      m.createProviderRuntime(resolveProviderSettings()),
    );
  }
  return runtimePromise;
}

function failStream(
  piStream: AssistantMessageEventStream,
  model: Model<Api>,
  cause: unknown,
): void {
  const reason = cause instanceof Error ? cause.message : String(cause);
  endStreamWithError(
    piStream,
    createEventBridge(piStream, model).getOutput(),
    "error",
    `pi-agy-cli could not start its provider runtime: ${reason}`,
  );
}

export default function (pi: ExtensionAPI): void {
  const probe = () => import("./src/model-probe.ts");
  const refreshModels = createModelRefresh({
    models: async (signal) => (await probe()).probeAccountModels(signal),
  });

  // Fallback until pi's startup model refresh replaces it with the account's families.
  const models = defaultFallbackModels().map(piModel);

  pi.registerCommand("pi-agy-cli-status", {
    description: "Show Antigravity CLI (agy) availability and auth status",
    handler: async (_args, ctx) => {
      const status = await probeCliAuthStatus();
      ctx.ui.notify(describeCliAuthStatus(status), "info");
    },
  });

  pi.registerProvider(PROVIDER_ID, {
    baseUrl: PROVIDER_ID,
    apiKey: "unused",
    api: PROVIDER_ID,
    models,
    refreshModels: async (context) => (await refreshModels(context.signal)).map(piModel),
    streamSimple: (model, context, options) => {
      const stream = createAssistantMessageEventStream();
      void loadRuntime()
        .then((runtime) => runtime.startEpisode(stream, model, context, options))
        .catch((err: unknown) => failStream(stream, model, err));
      return stream;
    },
  });
}
