/**
 * Translates ACP stream events into pi AssistantMessageEventStream events.
 * Effect-free: imported eagerly by index.ts.
 */

import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";

export type AgyStreamEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "thinking_delta"; readonly thinking: string }
  | {
      readonly type: "tool_call";
      readonly id: string;
      readonly name: string;
      readonly arguments: ToolCall["arguments"];
    }
  | {
      readonly type: "usage";
      readonly input: number;
      readonly output: number;
      readonly cacheRead: number;
      readonly cacheWrite: number;
      readonly totalTokens: number;
    }
  | { readonly type: "done"; readonly stopReason?: "stop" | "length" | "toolUse" };

export interface EventBridge {
  readonly handleEvent: (event: AgyStreamEvent) => void;
  readonly getOutput: () => AssistantMessage;
}

export function createEventBridge(
  stream: AssistantMessageEventStream,
  model: Model<Api>,
): EventBridge {
  const content: (TextContent | ThinkingContent | ToolCall)[] = [];
  const output: AssistantMessage = {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  let started = false;
  let activeTextIndex: number | undefined;
  let activeThinkingIndex: number | undefined;

  const ensureStarted = (): void => {
    if (!started) {
      stream.push({ type: "start", partial: output });
      started = true;
    }
  };

  const closeActiveBlocks = (): void => {
    if (activeTextIndex !== undefined) {
      const block = content[activeTextIndex];
      if (block && block.type === "text") {
        stream.push({
          type: "text_end",
          contentIndex: activeTextIndex,
          content: block.text,
          partial: output,
        });
      }
      activeTextIndex = undefined;
    }
    if (activeThinkingIndex !== undefined) {
      const block = content[activeThinkingIndex];
      if (block && block.type === "thinking") {
        stream.push({
          type: "thinking_end",
          contentIndex: activeThinkingIndex,
          content: block.thinking,
          partial: output,
        });
      }
      activeThinkingIndex = undefined;
    }
  };

  const handleEvent = (event: AgyStreamEvent): void => {
    ensureStarted();

    switch (event.type) {
      case "text_delta": {
        if (activeTextIndex === undefined) {
          activeTextIndex = content.length;
          content.push({ type: "text", text: "" });
          stream.push({ type: "text_start", contentIndex: activeTextIndex, partial: output });
        }
        const block = content[activeTextIndex];
        if (block && block.type === "text") {
          block.text += event.text;
          stream.push({
            type: "text_delta",
            contentIndex: activeTextIndex,
            delta: event.text,
            partial: output,
          });
        }
        break;
      }
      case "thinking_delta": {
        if (activeThinkingIndex === undefined) {
          activeThinkingIndex = content.length;
          content.push({ type: "thinking", thinking: "" });
          stream.push({
            type: "thinking_start",
            contentIndex: activeThinkingIndex,
            partial: output,
          });
        }
        const block = content[activeThinkingIndex];
        if (block && block.type === "thinking") {
          block.thinking += event.thinking;
          stream.push({
            type: "thinking_delta",
            contentIndex: activeThinkingIndex,
            delta: event.thinking,
            partial: output,
          });
        }
        break;
      }
      case "tool_call": {
        const index = content.length;
        const toolCall: ToolCall = {
          type: "toolCall",
          id: event.id,
          name: event.name,
          arguments: event.arguments,
        };
        content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
        stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output });
        break;
      }
      case "usage": {
        output.usage.input = event.input;
        output.usage.output = event.output;
        output.usage.cacheRead = event.cacheRead;
        output.usage.cacheWrite = event.cacheWrite;
        output.usage.totalTokens = event.totalTokens;
        break;
      }
      case "done": {
        closeActiveBlocks();
        output.stopReason = event.stopReason ?? "stop";
        stream.push({ type: "done", reason: output.stopReason, message: output });
        stream.end();
        break;
      }
    }
  };

  return {
    handleEvent,
    getOutput: () => output,
  };
}
