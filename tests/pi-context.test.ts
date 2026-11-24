import { describe, expect, it } from "vite-plus/test";
import {
  buildAcpPromptBlocks,
  buildFlatPrompt,
  buildLatestUserPrompt,
  extractTrailingToolResults,
} from "../src/pi-context.ts";

describe("pi-context", () => {
  it("flattens system prompt, tool routing, text, thinking, toolCall, and image blocks", () => {
    const prompt = buildFlatPrompt({
      systemPrompt: "Be concise.",
      tools: [{ name: "read", description: "Read file", parameters: {} }],
      messages: [
        { role: "user", content: "hello", timestamp: 1 },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "step 1" },
            { type: "text", text: "hi" },
            { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } },
          ],
          api: "pi-agy-cli",
          provider: "pi-agy-cli",
          model: "gemini-4-neon-high",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: 2,
        },
        {
          role: "user",
          content: [{ type: "image", data: "abc", mimeType: "image/png" }],
          timestamp: 3,
        },
      ],
    });

    expect(prompt).toContain("SYSTEM:\nBe concise.");
    expect(prompt).toContain("mcp_pi-tools_read");
    expect(prompt).toContain("USER:\nhello");
    expect(prompt).toContain("[thinking]\nstep 1");
    expect(prompt).toContain('[toolCall read] {"path":"a.ts"}');
    expect(prompt).toContain("[image]");
  });

  it("builds ACP prompt blocks including native base64 images from the latest user message", () => {
    const blocks = buildAcpPromptBlocks(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe this" },
              { type: "image", data: "BASE64DATA", mimeType: "image/png" },
            ],
            timestamp: 1,
          },
        ],
      },
      "turn",
    );

    expect(blocks).toEqual([
      { type: "text", text: "describe this\n[image]" },
      { type: "image", data: "BASE64DATA", mimeType: "image/png" },
    ]);
  });

  it("extracts trailing toolResult messages for handoff and handles empty contexts", () => {
    expect(buildLatestUserPrompt({ messages: [] })).toBe("");
    const results = extractTrailingToolResults({
      messages: [
        { role: "user", content: "run read", timestamp: 1 },
        {
          role: "toolResult",
          toolCallId: "pi-mcp-1",
          toolName: "read",
          content: [{ type: "text", text: "ok" }],
          isError: false,
          timestamp: 2,
        },
        {
          role: "toolResult",
          toolCallId: "pi-mcp-2",
          toolName: "bash",
          content: [{ type: "text", text: "fail" }],
          isError: true,
          timestamp: 3,
        },
      ],
    });

    expect(results).toEqual([
      { toolCallId: "pi-mcp-1", toolName: "read", text: "ok", isError: false },
      { toolCallId: "pi-mcp-2", toolName: "bash", text: "fail", isError: true },
    ]);
  });

  it("extracts system prompt and tools from pi 1.x TranscriptContext system messages", () => {
    const prompt = buildFlatPrompt({
      messages: [
        {
          role: "system",
          content: "You are pi.",
          toolsAdded: [{ name: "bash", description: "Run shell", parameters: {} as any }],
          timestamp: 1,
        } as any,
        { role: "user", content: "hi", timestamp: 2 },
      ],
    });

    expect(prompt).toContain("SYSTEM:\nYou are pi.");
    expect(prompt).toContain("mcp_pi-tools_bash");
    expect(prompt).toContain("USER:\nhi");
  });
});
