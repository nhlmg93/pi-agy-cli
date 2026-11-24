/**
 * Driver for running Effect-service scenarios against the ACP stub (`tests/e2e/agy-stub.cjs`).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEvent,
  type Context as PiContext,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { resolveProviderSettings } from "../../src/provider-env.ts";
import { createProviderRuntime } from "../../src/provider-runtime.ts";
import { traceFileForDate } from "../../src/trace-location.ts";

const TEST_MODEL: Model<Api> = {
  id: "gemini-4-neon-high",
  name: "Gemini 4 Neon (High)",
  api: "pi-agy-cli",
  provider: "pi-agy-cli",
  baseUrl: "pi-agy-cli",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 64_000,
};

const READ_TOOL = {
  name: "read",
  description: "Read a file",
  parameters: Type.Object({ path: Type.String() }),
};

async function collect(
  runtime: ReturnType<typeof createProviderRuntime>,
  context: PiContext,
  options?: SimpleStreamOptions,
): Promise<readonly AssistantMessageEvent[]> {
  const stream = createAssistantMessageEventStream();
  runtime.startEpisode(stream, TEST_MODEL, context, options);
  const events: AssistantMessageEvent[] = [];
  for await (const ev of stream) {
    events.push(ev);
  }
  return events;
}

export async function runAllScenarios(): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), "pi-agy-cli-scenarios-"));
  const pidFile = join(workDir, "pids.txt");
  const prevStateHome = process.env.XDG_STATE_HOME;
  const prevPidFile = process.env.AGY_STUB_PID_FILE;

  process.env.XDG_STATE_HOME = join(workDir, "state");
  process.env.AGY_STUB_PID_FILE = pidFile;

  const stubBin = resolve("tests/e2e/agy-stub.cjs");
  const runtime = createProviderRuntime(resolveProviderSettings({ PI_AGY_CLI_BIN: stubBin }));

  try {
    // 1. Cold spawn + warm turn reuse (same PID, usage reported)
    const turn1 = await collect(
      runtime,
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
      { sessionId: "sess-warm" },
    );
    const done1 = turn1.find((e) => e.type === "done");
    if (!done1 || done1.type !== "done") throw new Error("warm-turn: turn 1 did not complete");
    if (done1.message.usage.totalTokens !== 18) {
      throw new Error(`warm-turn: expected 18 totalTokens, got ${done1.message.usage.totalTokens}`);
    }

    const turn2 = await collect(
      runtime,
      {
        messages: [
          { role: "user", content: "hello", timestamp: 1 },
          { role: "user", content: "follow up", timestamp: 2 },
        ],
      },
      { sessionId: "sess-warm", reasoning: "medium" },
    );
    const done2 = turn2.find((e) => e.type === "done");
    if (!done2 || done2.type !== "done") throw new Error("warm-turn: turn 2 did not complete");

    const pids = readFileSync(pidFile, "utf8").trim().split("\n").filter(Boolean);
    if (pids.length !== 1) {
      throw new Error(`warm-turn: expected 1 spawned process, got ${pids.length}`);
    }

    // 2. Thinking + text streaming
    const thinkEvents = await collect(
      runtime,
      { messages: [{ role: "user", content: "think", timestamp: 3 }] },
      { sessionId: "sess-think" },
    );
    if (!thinkEvents.some((e) => e.type === "thinking_delta")) {
      throw new Error("think: expected thinking_delta event");
    }

    // 3. Full held-open loopback MCP tool call -> handoff roundtrip!
    const toolTurn1 = await collect(
      runtime,
      {
        tools: [READ_TOOL],
        messages: [{ role: "user", content: "tool:read", timestamp: 4 }],
      },
      { sessionId: "sess-handoff" },
    );
    const doneTool1 = toolTurn1.find((e) => e.type === "done");
    if (!doneTool1 || doneTool1.type !== "done" || doneTool1.reason !== "toolUse") {
      throw new Error("handoff: expected toolUse stopReason on turn 1");
    }
    const toolCallBlock = doneTool1.message.content.find((b) => b.type === "toolCall");
    if (!toolCallBlock || toolCallBlock.type !== "toolCall") {
      throw new Error("handoff: missing toolCall block");
    }
    // Verify agy's injected toolSummary was stripped
    if ("toolSummary" in toolCallBlock.arguments) {
      throw new Error("handoff: toolSummary was not stripped from tool arguments");
    }

    const toolTurn2 = await collect(
      runtime,
      {
        tools: [READ_TOOL],
        messages: [
          { role: "user", content: "tool:read", timestamp: 4 },
          doneTool1.message,
          {
            role: "toolResult",
            toolCallId: toolCallBlock.id,
            toolName: "read",
            content: [{ type: "text", text: "FILE-CONTENTS-42" }],
            isError: false,
            timestamp: 5,
          },
        ],
      },
      { sessionId: "sess-handoff" },
    );
    const doneTool2 = toolTurn2.find((e) => e.type === "done");
    if (!doneTool2 || doneTool2.type !== "done") {
      throw new Error("handoff: turn 2 did not complete");
    }
    const replyText = doneTool2.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!replyText.includes("TOOL-DONE FILE-CONTENTS-42")) {
      throw new Error(`handoff: unexpected reply text "${replyText}"`);
    }

    // 4. Native agy tool permission request is denied
    const nativeEvents = await collect(
      runtime,
      { messages: [{ role: "user", content: "native", timestamp: 6 }] },
      { sessionId: "sess-native" },
    );
    const nativeDone = nativeEvents.find((e) => e.type === "done");
    if (!nativeDone || nativeDone.type !== "done") throw new Error("native: did not complete");
    const nativeText = nativeDone.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!nativeText.includes("NATIVE-DENIED")) {
      throw new Error(`native: expected NATIVE-DENIED, got "${nativeText}"`);
    }

    // 5. Abort signal -> aborted terminal event
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const abortEvents = await collect(
      runtime,
      { messages: [{ role: "user", content: "hang", timestamp: 7 }] },
      { sessionId: "sess-abort", signal: ac.signal },
    );
    const abortErr = abortEvents.find((e) => e.type === "error");
    if (!abortErr || abortErr.type !== "error" || abortErr.reason !== "aborted") {
      throw new Error("abort: expected aborted terminal error event");
    }

    // 6. Subprocess crash -> terminal error event
    const dieEvents = await collect(
      runtime,
      { messages: [{ role: "user", content: "die", timestamp: 8 }] },
      { sessionId: "sess-die" },
    );
    if (!dieEvents.some((e) => e.type === "error")) {
      throw new Error("die: expected terminal error event");
    }

    // 7. Trace spans recorded
    const traceFile = traceFileForDate();
    const traceLines = readFileSync(traceFile, "utf8").trim().split("\n").filter(Boolean);
    if (traceLines.length < 6) {
      throw new Error(`traces: expected at least 6 spans, got ${traceLines.length}`);
    }

    console.log(
      `[pi-agy-cli] all ACP scenarios passed (${traceLines.length} trace spans recorded)`,
    );
  } finally {
    await runtime.shutdown();
    if (prevStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = prevStateHome;
    if (prevPidFile === undefined) delete process.env.AGY_STUB_PID_FILE;
    else process.env.AGY_STUB_PID_FILE = prevPidFile;
    rmSync(workDir, { recursive: true, force: true });
  }
}
