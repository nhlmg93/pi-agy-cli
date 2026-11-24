/**
 * ACP (Agent Client Protocol) JSON-RPC 2.0 wire protocol helpers for `agy acp`.
 */

import { PI_MCP_TOOL_PREFIX } from "./tool-mapping.ts";

export interface AcpUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cachedWriteTokens: number;
  readonly thoughtTokens: number;
  readonly totalTokens: number;
}

export interface AcpPermissionOption {
  readonly optionId: string;
  readonly name?: string;
  readonly kind?: string;
}

export interface AcpPermissionRequestParams {
  readonly sessionId?: string;
  readonly toolCall?: {
    readonly toolCallId?: string;
    readonly name?: string;
    readonly args?: Record<string, unknown>;
  };
  readonly options?: readonly AcpPermissionOption[];
}

export interface AcpPromptTextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface AcpPromptImageBlock {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export type AcpPromptBlock = AcpPromptTextBlock | AcpPromptImageBlock;

export function parseAcpLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function encodeJsonRpcRequest(
  id: number | string,
  method: string,
  params?: Record<string, unknown>,
): string {
  const payload: Record<string, unknown> = {
    jsonrpc: "2.0",
    id,
    method,
  };
  if (params !== undefined) {
    payload.params = params;
  }
  return JSON.stringify(payload) + "\n";
}

export function encodeJsonRpcResponse(
  id: number | string,
  result: Record<string, unknown>,
): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
}

export function encodeJsonRpcNotification(
  method: string,
  params?: Record<string, unknown>,
): string {
  const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params !== undefined) payload.params = params;
  return JSON.stringify(payload) + "\n";
}

/**
 * Permission gate for `session/request_permission`:
 * - Allow pi-owned MCP tools (`mcp_pi-tools_*`) so they reach our loopback MCP bridge.
 * - Deny all native `agy` built-in tools so pi remains the sole tool executor.
 */
export function selectPermissionOptionId(params: AcpPermissionRequestParams): string | undefined {
  const toolName = params.toolCall?.name ?? "";
  const options = params.options ?? [];
  const isPiMcpTool = toolName.startsWith(PI_MCP_TOOL_PREFIX);

  if (isPiMcpTool) {
    const allow = options.find(
      (opt) => opt.kind === "allow_once" || opt.kind === "allow_always" || opt.optionId === "allow",
    );
    return allow?.optionId ?? options[0]?.optionId;
  }

  const deny = options.find(
    (opt) => opt.kind === "reject_once" || opt.kind === "reject_always" || opt.optionId === "deny",
  );
  return deny?.optionId ?? options[options.length - 1]?.optionId;
}

export function extractAcpUsage(raw: unknown): AcpUsage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const num = (key: string): number => (typeof obj[key] === "number" ? obj[key] : 0);
  return {
    inputTokens: num("inputTokens"),
    outputTokens: num("outputTokens"),
    cachedReadTokens: num("cachedReadTokens"),
    cachedWriteTokens: num("cachedWriteTokens"),
    thoughtTokens: num("thoughtTokens"),
    totalTokens: num("totalTokens"),
  };
}
