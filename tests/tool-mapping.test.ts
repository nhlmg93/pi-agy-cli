import { describe, expect, it } from "vite-plus/test";
import {
  fromAgyMcpToolName,
  isPiMcpToolName,
  PI_MCP_TOOL_PREFIX,
  sanitizeToolArguments,
  toAgyMcpToolName,
} from "../src/tool-mapping.ts";

describe("tool-mapping", () => {
  it("converts pi tool names to and from agy MCP names", () => {
    expect(toAgyMcpToolName("read")).toBe(`${PI_MCP_TOOL_PREFIX}read`);
    expect(fromAgyMcpToolName(`${PI_MCP_TOOL_PREFIX}read`)).toBe("read");
    expect(fromAgyMcpToolName("run_command")).toBe("run_command");
    expect(isPiMcpToolName(`${PI_MCP_TOOL_PREFIX}bash`)).toBe(true);
    expect(isPiMcpToolName("run_command")).toBe(false);
  });

  it("strips agy-injected toolSummary unless explicitly declared in tool schema", () => {
    expect(sanitizeToolArguments(null)).toEqual({});
    expect(
      sanitizeToolArguments({ path: "a.ts", toolSummary: "Read a.ts" }, new Set(["path"])),
    ).toEqual({ path: "a.ts" });
    expect(
      sanitizeToolArguments(
        { path: "a.ts", toolSummary: "keep me" },
        new Set(["path", "toolSummary"]),
      ),
    ).toEqual({ path: "a.ts", toolSummary: "keep me" });
  });
});
