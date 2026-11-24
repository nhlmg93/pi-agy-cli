/**
 * Tool naming and argument normalization between pi and our loopback MCP server
 * exposed to `agy acp`.
 */

import type { ToolCall } from "@earendil-works/pi-ai";

export const PI_MCP_SERVER_NAME = "pi-tools";
export const PI_MCP_TOOL_PREFIX = `mcp_${PI_MCP_SERVER_NAME}_`;

export function toAgyMcpToolName(piName: string): string {
  return `${PI_MCP_TOOL_PREFIX}${piName}`;
}

export function fromAgyMcpToolName(agyName: string): string {
  if (agyName.startsWith(PI_MCP_TOOL_PREFIX)) {
    return agyName.slice(PI_MCP_TOOL_PREFIX.length);
  }
  return agyName;
}

export function isPiMcpToolName(agyName: string): boolean {
  return agyName.startsWith(PI_MCP_TOOL_PREFIX);
}

/**
 * `agy` injects a `toolSummary` field into MCP tool arguments for UI display.
 * Strip it unless the pi tool's schema explicitly declares `toolSummary`.
 */
export function sanitizeToolArguments(
  rawArgs: unknown,
  declaredPropertyNames?: ReadonlySet<string>,
): ToolCall["arguments"] {
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawArgs as Record<string, unknown>)) {
    if (key === "toolSummary" && !declaredPropertyNames?.has("toolSummary")) {
      continue;
    }
    result[key] = value;
  }
  return result as ToolCall["arguments"];
}
