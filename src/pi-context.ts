/**
 * Resolves pi's Context / TranscriptContext (system prompt + active tools +
 * non-system messages), converts history into ACP prompt blocks (text + native
 * images), and extracts trailing tool results for handoff episodes.
 */

import {
  getCurrentSystemPrompt,
  getCurrentTools,
  type Context as PiContext,
  type Message,
  type Tool,
  type ToolResultMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { AcpPromptBlock } from "./cli-protocol.ts";
import { PI_MCP_SERVER_NAME } from "./tool-mapping.ts";

export type PiInputContext = PiContext | TranscriptContext;

export interface ResolvedPiRequest {
  readonly systemPrompt: string;
  readonly tools: readonly Tool[];
  readonly messages: readonly Message[];
}

export interface IncomingToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly text: string;
  readonly isError: boolean;
}

export function resolvePiRequest(context: PiInputContext): ResolvedPiRequest {
  const isTranscript = context.messages.some((m) => m.role === "system");
  const messages = context.messages.filter((m) => m.role !== "system");
  const tools = isTranscript
    ? getCurrentTools(context.messages)
    : "tools" in context
      ? (context.tools ?? [])
      : [];
  const systemPrompt = isTranscript
    ? getCurrentSystemPrompt(context.messages)
    : "systemPrompt" in context
      ? (context.systemPrompt ?? "")
      : "";
  return { systemPrompt, tools, messages };
}

function renderMessageText(message: Message): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return `[thinking]\n${block.thinking}`;
      if (block.type === "toolCall") {
        return `[toolCall ${block.name}] ${JSON.stringify(block.arguments)}`;
      }
      if (block.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function renderToolResultText(message: ToolResultMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractTrailingImages(message: Message | undefined): readonly AcpPromptBlock[] {
  if (!message || typeof message.content === "string") return [];
  const images: AcpPromptBlock[] = [];
  for (const block of message.content) {
    if (block.type === "image" && block.data && block.mimeType) {
      images.push({ type: "image", data: block.data, mimeType: block.mimeType });
    }
  }
  return images;
}

export function buildFlatPrompt(context: PiInputContext): string {
  const resolved = resolvePiRequest(context);
  const sections: string[] = [];
  if (resolved.systemPrompt) {
    sections.push(`SYSTEM:\n${resolved.systemPrompt}`);
  }
  if (resolved.tools.length > 0) {
    const names = resolved.tools.map((t) => `mcp_${PI_MCP_SERVER_NAME}_${t.name}`).join(", ");
    sections.push(
      `TOOL ROUTING:\nAlways use the ${PI_MCP_SERVER_NAME} MCP tools (${names}) instead of native built-in tools.`,
    );
  }
  for (const msg of resolved.messages) {
    const label = msg.role.toUpperCase();
    sections.push(`${label}:\n${renderMessageText(msg)}`);
  }
  return sections.join("\n\n");
}

export function buildLatestUserPrompt(context: PiInputContext): string {
  const resolved = resolvePiRequest(context);
  const last = resolved.messages[resolved.messages.length - 1];
  if (!last) return "";
  return renderMessageText(last);
}

export function buildAcpPromptBlocks(
  context: PiInputContext,
  mode: "spawn" | "turn",
): readonly AcpPromptBlock[] {
  const resolved = resolvePiRequest(context);
  const text = mode === "spawn" ? buildFlatPrompt(context) : buildLatestUserPrompt(context);
  const last = resolved.messages[resolved.messages.length - 1];
  const images = extractTrailingImages(last);
  const blocks: AcpPromptBlock[] = [];
  if (text) blocks.push({ type: "text", text });
  blocks.push(...images);
  return blocks;
}

/**
 * Extracts consecutive trailing `toolResult` messages added by pi since the last
 * assistant message (used to feed held-open MCP `tools/call` responses on handoff).
 */
export function extractTrailingToolResults(context: PiInputContext): readonly IncomingToolResult[] {
  const resolved = resolvePiRequest(context);
  const results: IncomingToolResult[] = [];
  for (let i = resolved.messages.length - 1; i >= 0; i--) {
    const msg = resolved.messages[i];
    if (!msg || msg.role !== "toolResult") break;
    results.push({
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      text: renderToolResultText(msg),
      isError: msg.isError,
    });
  }
  return results.reverse();
}
