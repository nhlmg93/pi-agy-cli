/**
 * In-process loopback Streamable HTTP MCP server for `agy acp`.
 *
 * Exposes pi's active tools via `session/new`'s `mcpServers` config with zero
 * extra child processes. When `agy` calls `tools/call`, the HTTP request is
 * held open while pi executes the tool natively, then answered during the next
 * `handoff` episode.
 */

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { Effect, Scope } from "effect";
import { AgyProcessError } from "./errors.ts";
import { PI_MCP_SERVER_NAME, sanitizeToolArguments } from "./tool-mapping.ts";

export interface HeldToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: ToolCall["arguments"];
}

export interface LoopbackMcpServer {
  readonly url: string;
  readonly mcpServerConfig: {
    readonly type: "http";
    readonly name: string;
    readonly url: string;
    readonly headers: readonly { readonly name: string; readonly value: string }[];
  };
  readonly setTools: (tools: readonly Tool[]) => void;
  readonly setOnToolCall: (cb: ((call: HeldToolCall) => void) | undefined) => void;
  readonly resolveToolCall: (id: string, text: string, isError?: boolean) => boolean;
  readonly hasPendingToolCalls: () => boolean;
  readonly pendingToolCallIds: () => readonly string[];
  readonly unref: () => void;
  readonly ref: () => void;
  readonly close: () => Promise<void>;
}

interface PendingHttpCall {
  readonly res: ServerResponse;
  readonly jsonRpcId: unknown;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json", connection: "close" });
  res.end(JSON.stringify(body));
}

function extractDeclaredProperties(schema: unknown): ReadonlySet<string> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return new Set();
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return new Set();
  return new Set(Object.keys(props));
}

export function startLoopbackMcpServer(
  initialTools: readonly Tool[] = [],
): Effect.Effect<LoopbackMcpServer, AgyProcessError, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.callback<LoopbackMcpServer, AgyProcessError>((resume) => {
      const token = randomBytes(16).toString("hex");
      const mcpPath = `/mcp/${token}`;

      let currentTools: readonly Tool[] = initialTools;
      let onToolCall: ((call: HeldToolCall) => void) | undefined;
      let callSeq = 1;
      const pending = new Map<string, PendingHttpCall>();

      const server: Server = createServer((req, res) => {
        if (req.method !== "POST" || req.url !== mcpPath) {
          res.writeHead(404, { connection: "close" });
          res.end();
          return;
        }

        void readBody(req)
          .then((raw) => {
            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              writeJson(res, 400, { error: "invalid json" });
              return;
            }

            const method = typeof msg.method === "string" ? msg.method : "";
            const id = msg.id;

            if (method === "initialize") {
              writeJson(res, 200, {
                jsonrpc: "2.0",
                id,
                result: {
                  protocolVersion: "2025-03-26",
                  capabilities: { tools: { listChanged: true } },
                  serverInfo: { name: PI_MCP_SERVER_NAME, version: "0.1.0" },
                },
              });
              return;
            }

            if (method.startsWith("notifications/")) {
              res.writeHead(202, { connection: "close" });
              res.end();
              return;
            }

            if (method === "tools/list") {
              const tools = currentTools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.parameters,
              }));
              writeJson(res, 200, { jsonrpc: "2.0", id, result: { tools } });
              return;
            }

            if (method === "tools/call") {
              const params = (msg.params ?? {}) as Record<string, unknown>;
              const name = typeof params.name === "string" ? params.name : "";
              const toolDef = currentTools.find((t) => t.name === name);
              const declaredProps = extractDeclaredProperties(toolDef?.parameters);
              const args = sanitizeToolArguments(params.arguments, declaredProps);
              const callId = `pi-mcp-${callSeq++}`;

              pending.set(callId, { res, jsonRpcId: id });
              res.once("close", () => {
                pending.delete(callId);
              });

              if (onToolCall) {
                onToolCall({ id: callId, name, arguments: args });
              } else {
                pending.delete(callId);
                writeJson(res, 200, {
                  jsonrpc: "2.0",
                  id,
                  result: {
                    content: [{ type: "text", text: "No active episode to execute tool call." }],
                    isError: true,
                  },
                });
              }
              return;
            }

            writeJson(res, 200, { jsonrpc: "2.0", id, result: {} });
          })
          .catch(() => {
            if (!res.writableEnded) {
              res.writeHead(500);
              res.end();
            }
          });
      });

      server.on("connection", (socket) => {
        socket.unref();
      });

      server.once("error", (err) => {
        resume(Effect.fail(new AgyProcessError({ message: `MCP server error: ${err.message}` })));
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          server.close();
          resume(Effect.fail(new AgyProcessError({ message: "Failed to bind loopback MCP port" })));
          return;
        }
        const url = `http://127.0.0.1:${addr.port}${mcpPath}`;

        const close = (): Promise<void> =>
          new Promise((resolveClose) => {
            for (const entry of pending.values()) {
              writeJson(entry.res, 200, {
                jsonrpc: "2.0",
                id: entry.jsonRpcId,
                result: {
                  content: [{ type: "text", text: "Session closed." }],
                  isError: true,
                },
              });
            }
            pending.clear();
            server.close(() => resolveClose());
          });

        resume(
          Effect.succeed({
            url,
            mcpServerConfig: {
              type: "http",
              name: PI_MCP_SERVER_NAME,
              url,
              headers: [],
            },
            setTools: (tools) => {
              currentTools = tools;
            },
            setOnToolCall: (cb) => {
              onToolCall = cb;
            },
            resolveToolCall: (callId, text, isError = false) => {
              const entry = pending.get(callId);
              if (!entry) return false;
              pending.delete(callId);
              writeJson(entry.res, 200, {
                jsonrpc: "2.0",
                id: entry.jsonRpcId,
                result: {
                  content: [{ type: "text", text }],
                  isError,
                },
              });
              return true;
            },
            hasPendingToolCalls: () => pending.size > 0,
            pendingToolCallIds: () => Array.from(pending.keys()),
            unref: () => {
              server.unref();
            },
            ref: () => {
              server.ref();
            },
            close,
          }),
        );
      });
    }),
    (mcp) => Effect.promise(() => mcp.close()),
  );
}
