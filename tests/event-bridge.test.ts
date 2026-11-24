import { createAssistantMessageEventStream, type Api, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vite-plus/test";
import { createEventBridge } from "../src/event-bridge.ts";
import { endStreamWithError } from "../src/terminal-event.ts";

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

describe("event-bridge", () => {
  it("streams thinking, text, and tool call events and ends cleanly", async () => {
    const stream = createAssistantMessageEventStream();
    const bridge = createEventBridge(stream, TEST_MODEL);

    bridge.handleEvent({ type: "thinking_delta", thinking: "plan" });
    bridge.handleEvent({ type: "text_delta", text: "PORT-" });
    bridge.handleEvent({ type: "text_delta", text: "OK" });
    bridge.handleEvent({
      type: "tool_call",
      id: "call-1",
      name: "read",
      arguments: { path: "README.md" },
    });
    bridge.handleEvent({
      type: "usage",
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 15,
    });
    bridge.handleEvent({ type: "done", stopReason: "toolUse" });

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.type);
    }

    expect(events).toEqual([
      "start",
      "thinking_start",
      "thinking_delta",
      "text_start",
      "text_delta",
      "text_delta",
      "toolcall_start",
      "toolcall_end",
      "text_end",
      "thinking_end",
      "done",
    ]);

    const output = bridge.getOutput();
    expect(output.stopReason).toBe("toolUse");
    expect(output.usage.totalTokens).toBe(15);
    expect(output.content).toEqual([
      { type: "thinking", thinking: "plan" },
      { type: "text", text: "PORT-OK" },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
    ]);
  });

  it("emits terminal error event via endStreamWithError", async () => {
    const stream = createAssistantMessageEventStream();
    const bridge = createEventBridge(stream, TEST_MODEL);

    endStreamWithError(stream, bridge.getOutput(), "error", "boom");

    const received = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("error");
  });
});
