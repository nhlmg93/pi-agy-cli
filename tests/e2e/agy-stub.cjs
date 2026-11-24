#!/usr/bin/env node
"use strict";

/**
 * Deterministic Antigravity ACP (`agy acp`) stub for pi-agy-cli scenarios and e2e.
 *
 * Speaks JSON-RPC 2.0 ACP over stdio AND calls back into the loopback Streamable
 * HTTP MCP server passed via `session/new.mcpServers`!
 *
 * Keyword-driven behaviors (matched against prompt text):
 *   (default)       streams agent_message_chunk "PORT-OK" and resolves session/prompt
 *   think           streams agent_thought_chunk "STUB-THOUGHT" then "PORT-OK"
 *   tool:<name>     POSTs tools/call to the loopback MCP server (holding open until
 *                   pi's handoff episode answers), then streams "TOOL-DONE <result>"
 *   tools:<a>,<b>   fires parallel tools/call requests to loopback MCP, joins results with "|"
 *   native          sends session/request_permission for a native tool ("run_command")
 *                   and confirms it was denied ("NATIVE-DENIED")
 *   die             writes to stderr and exits with code 3
 *   failturn        returns a JSON-RPC error on session/prompt
 *   hang            never resolves session/prompt (for abort/cancel testing)
 */

const fs = require("node:fs");
const http = require("node:http");
const readline = require("node:readline");

const args = process.argv.slice(2);

if (args.includes("--help")) {
  process.stdout.write("Usage of agy (stub)\n");
  process.exit(0);
}

if (args[0] === "models") {
  process.stdout.write("Fetching available models...\n");
  process.stdout.write("gemini-4-neon-high\tGemini 4 Neon (High)\n");
  process.stdout.write("gemini-4-neon-medium\tGemini 4 Neon (Medium)\n");
  process.stdout.write("gemini-4-neon-low\tGemini 4 Neon (Low)\n");
  process.exit(0);
}

if (process.env.AGY_STUB_PID_FILE) {
  fs.appendFileSync(process.env.AGY_STUB_PID_FILE, `${process.pid}\n`);
}

const send = (obj) => {
  process.stdout.write(JSON.stringify(obj) + "\n");
};

let mcpConfig = null;
let mcpReqSeq = 1;
const pendingClientRequests = new Map();

function postMcp(method, params) {
  return new Promise((resolve, reject) => {
    if (!mcpConfig || !mcpConfig.url) {
      reject(new Error("No MCP server configured"));
      return;
    }
    const url = new URL(mcpConfig.url);
    const body = JSON.stringify({ jsonrpc: "2.0", id: mcpReqSeq++, method, params });
    const headers = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    };
    for (const h of mcpConfig.headers || []) {
      headers[h.name] = h.value;
    }
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c.toString("utf8");
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({});
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sendPermissionRequest(sessionId, toolName) {
  return new Promise((resolve) => {
    const id = `perm-${Date.now()}-${Math.random()}`;
    pendingClientRequests.set(id, resolve);
    send({
      jsonrpc: "2.0",
      id,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: { toolCallId: "native-1", name: toolName, args: {} },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    });
  });
}

function extractPromptText(promptBlocks) {
  if (!Array.isArray(promptBlocks)) return "";
  const full = promptBlocks
    .map((b) => (b && b.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("\n");
  const idx = full.lastIndexOf("USER:\n");
  return idx >= 0 ? full.slice(idx + 6) : full;
}

const SESSION_ID = "stub-session-1";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  // Response to our outgoing permission request
  if (!msg.method && msg.id !== undefined && pendingClientRequests.has(msg.id)) {
    const resolver = pendingClientRequests.get(msg.id);
    pendingClientRequests.delete(msg.id);
    resolver(msg.result);
    return;
  }

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { promptCapabilities: { image: true } },
        agentInfo: { name: "Antigravity ACP Stub", version: "0.1.0" },
      },
    });
    return;
  }

  if (msg.method === "session/new") {
    const servers = msg.params?.mcpServers;
    if (Array.isArray(servers) && servers.length > 0) {
      mcpConfig = servers[0];
      void postMcp("initialize", { protocolVersion: "2025-03-26", capabilities: {} }).then(() =>
        postMcp("tools/list", {}),
      );
    }
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        sessionId: SESSION_ID,
        models: { currentModelId: "gemini-4-neon-high", availableModels: [] },
      },
    });
    return;
  }

  if (msg.method === "session/set_model" || msg.method === "session/set_config_option") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }

  if (msg.method === "session/cancel") {
    return;
  }

  if (msg.method === "session/prompt") {
    const text = extractPromptText(msg.params?.prompt);
    const reqId = msg.id;

    if (text.includes("die")) {
      process.stderr.write("stub fatal error\n");
      process.exit(3);
    }

    if (text.includes("hang")) {
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hanging..." },
          },
        },
      });
      return;
    }

    if (text.includes("failturn")) {
      send({
        jsonrpc: "2.0",
        id: reqId,
        error: { code: -32000, message: "stub turn failed" },
      });
      return;
    }

    if (text.includes("native")) {
      void sendPermissionRequest(SESSION_ID, "run_command").then((res) => {
        const chosen = res?.outcome?.optionId;
        const reply = chosen === "deny" ? "NATIVE-DENIED" : `NATIVE-${chosen}`;
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: reply },
            },
          },
        });
        send({
          jsonrpc: "2.0",
          id: reqId,
          result: {
            stopReason: "end_turn",
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              cachedReadTokens: 0,
              cachedWriteTokens: 0,
              thoughtTokens: 0,
              totalTokens: 12,
            },
          },
        });
      });
      return;
    }

    const toolsMatch = text.match(/tools:([a-zA-Z0-9_,-]+)/);
    const toolMatch = !toolsMatch && text.match(/tool:([a-zA-Z0-9_-]+)/);
    if (toolsMatch || toolMatch) {
      const names = toolsMatch ? toolsMatch[1].split(",").filter(Boolean) : [toolMatch[1]];
      void Promise.all(
        names.map((name) =>
          postMcp("tools/call", {
            name,
            arguments: { path: "README.md", toolSummary: `Call ${name}` },
          }),
        ),
      ).then((responses) => {
        const joined = responses.map((r) => r?.result?.content?.[0]?.text ?? "").join("|");
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: `TOOL-DONE ${joined}` },
            },
          },
        });
        send({
          jsonrpc: "2.0",
          id: reqId,
          result: {
            stopReason: "end_turn",
            usage: {
              inputTokens: 20,
              outputTokens: 5,
              cachedReadTokens: 10,
              cachedWriteTokens: 0,
              thoughtTokens: 0,
              totalTokens: 25,
            },
          },
        });
      });
      return;
    }

    if (text.includes("think")) {
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "STUB-THOUGHT" },
          },
        },
      });
    }

    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "PORT-OK" },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: reqId,
      result: {
        stopReason: "end_turn",
        usage: {
          inputTokens: 15,
          outputTokens: 3,
          cachedReadTokens: 5,
          cachedWriteTokens: 0,
          thoughtTokens: 4,
          totalTokens: 18,
        },
      },
    });
  }
});
