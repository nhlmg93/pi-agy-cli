import { describe, expect, it } from "vite-plus/test";
import {
  encodeJsonRpcNotification,
  encodeJsonRpcRequest,
  encodeJsonRpcResponse,
  extractAcpUsage,
  parseAcpLine,
  selectPermissionOptionId,
} from "../src/cli-protocol.ts";
import { PI_MCP_TOOL_PREFIX } from "../src/tool-mapping.ts";

describe("cli-protocol", () => {
  it("parses valid JSON-RPC object lines and ignores empty, non-object, or malformed lines", () => {
    expect(parseAcpLine("")).toBeNull();
    expect(parseAcpLine("   ")).toBeNull();
    expect(parseAcpLine("[debug] not json")).toBeNull();
    expect(parseAcpLine("{malformed")).toBeNull();
    expect(parseAcpLine("[1,2,3]")).toBeNull();
    expect(parseAcpLine('{"jsonrpc":"2.0","id":1,"result":{}}\n')).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
  });

  it("encodes JSON-RPC requests, responses, and notifications as NDJSON", () => {
    const req = encodeJsonRpcRequest(1, "initialize", { protocolVersion: 1 });
    expect(req.endsWith("\n")).toBe(true);
    expect(JSON.parse(req)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1 },
    });

    const res = encodeJsonRpcResponse("p1", { outcome: { outcome: "selected", optionId: "deny" } });
    expect(JSON.parse(res)).toEqual({
      jsonrpc: "2.0",
      id: "p1",
      result: { outcome: { outcome: "selected", optionId: "deny" } },
    });

    const notif = encodeJsonRpcNotification("session/cancel", { sessionId: "s1" });
    expect(JSON.parse(notif)).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "s1" },
    });
  });

  it("allows pi-tools MCP calls and denies native agy built-in tools", () => {
    const options = [
      { optionId: "allow", kind: "allow_once" },
      { optionId: "deny", kind: "reject_once" },
    ];

    expect(
      selectPermissionOptionId({
        toolCall: { name: `${PI_MCP_TOOL_PREFIX}read` },
        options,
      }),
    ).toBe("allow");

    expect(
      selectPermissionOptionId({
        toolCall: { name: "run_command" },
        options,
      }),
    ).toBe("deny");
  });

  it("extracts ACP usage objects safely", () => {
    expect(extractAcpUsage(undefined)).toBeUndefined();
    expect(extractAcpUsage([1, 2])).toBeUndefined();
    expect(
      extractAcpUsage({
        inputTokens: 100,
        outputTokens: 20,
        cachedReadTokens: 50,
        thoughtTokens: 10,
        totalTokens: 120,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cachedReadTokens: 50,
      cachedWriteTokens: 0,
      thoughtTokens: 10,
      totalTokens: 120,
    });
  });
});
