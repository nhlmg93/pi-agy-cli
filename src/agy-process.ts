/**
 * A single scoped `agy acp` subprocess + its in-process loopback MCP server.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Tool } from "@earendil-works/pi-ai";
import { Effect, Scope } from "effect";
import { buildAgyArgs, buildAgyEnv, type AgyLaunchSpec } from "./agy-cli.ts";
import {
  encodeJsonRpcNotification,
  encodeJsonRpcRequest,
  encodeJsonRpcResponse,
  extractAcpUsage,
  parseAcpLine,
  selectPermissionOptionId,
  type AcpPermissionRequestParams,
  type AcpPromptBlock,
  type AcpUsage,
} from "./cli-protocol.ts";
import { AgyProcessError } from "./errors.ts";
import { startLoopbackMcpServer, type LoopbackMcpServer } from "./mcp-inband.ts";
import type { AgyEffortLevel } from "./thinking-config.ts";

export interface AcpPromptOutcome {
  readonly stopReason: "stop" | "length" | "toolUse";
  readonly usage?: AcpUsage;
}

export type AcpSessionUpdate = Record<string, unknown>;

export interface AgyProcessHandle {
  readonly id: string;
  readonly spec: AgyLaunchSpec;
  readonly sessionId: string;
  readonly child: ChildProcess;
  readonly mcp: LoopbackMcpServer;
  readonly startPrompt: (blocks: readonly AcpPromptBlock[]) => Promise<AcpPromptOutcome>;
  readonly setEffort: (effort: AgyEffortLevel) => Promise<void>;
  readonly cancelPrompt: () => void;
  readonly setUpdateListener: (cb: ((update: AcpSessionUpdate) => void) | undefined) => void;
  readonly setExitListener: (cb: ((err: AgyProcessError) => void) | undefined) => void;
  readonly getStderr: () => string;
  readonly close: Effect.Effect<void>;
}

interface PendingRpc {
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (err: AgyProcessError) => void;
}

let nextProcessId = 1;

function mapAcpStopReason(raw: unknown): "stop" | "length" | "toolUse" {
  if (raw === "max_tokens") return "length";
  if (raw === "tool_use") return "toolUse";
  return "stop";
}

export function spawnAgyProcess(
  spec: AgyLaunchSpec,
  initialTools: readonly Tool[] = [],
): Effect.Effect<AgyProcessHandle, AgyProcessError, Scope.Scope> {
  return Effect.gen(function* () {
    const mcp = yield* startLoopbackMcpServer(initialTools);

    const handle = yield* Effect.acquireRelease(
      Effect.callback<AgyProcessHandle, AgyProcessError>((resume) => {
        const id = `agy-${nextProcessId++}`;
        const args = buildAgyArgs(spec);
        const child = spawn(spec.binary, [...args], {
          cwd: spec.cwd,
          env: buildAgyEnv(),
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stderrBuffer = "";
        child.stderr?.on("data", (chunk: Buffer) => {
          stderrBuffer += chunk.toString("utf8");
        });

        let rpcSeq = 1;
        const pendingRpc = new Map<number | string, PendingRpc>();
        let updateListener: ((update: AcpSessionUpdate) => void) | undefined;
        let exitListener: ((err: AgyProcessError) => void) | undefined;
        let closed = false;

        const writeRaw = (payload: string): void => {
          if (!child.stdin || child.stdin.destroyed) return;
          child.stdin.write(payload);
        };

        const sendRequest = (
          method: string,
          params?: Record<string, unknown>,
        ): Promise<Record<string, unknown>> =>
          new Promise((resolve, reject) => {
            if (closed || !child.stdin || child.stdin.destroyed) {
              reject(
                new AgyProcessError({ message: "agy acp stdin is closed", stderr: stderrBuffer }),
              );
              return;
            }
            const reqId = rpcSeq++;
            pendingRpc.set(reqId, { resolve, reject });
            writeRaw(encodeJsonRpcRequest(reqId, method, params));
          });

        const failAllPending = (err: AgyProcessError): void => {
          for (const entry of pendingRpc.values()) {
            entry.reject(err);
          }
          pendingRpc.clear();
        };

        child.once("error", (err) => {
          closed = true;
          const procErr = new AgyProcessError({ message: err.message, stderr: stderrBuffer });
          failAllPending(procErr);
          exitListener?.(procErr);
        });

        child.once("exit", (code) => {
          closed = true;
          const procErr = new AgyProcessError({
            message: `agy acp exited with code ${code ?? "null"}`,
            exitCode: code,
            stderr: stderrBuffer,
          });
          failAllPending(procErr);
          if (code && code !== 0) {
            exitListener?.(procErr);
          }
        });

        const rl = child.stdout ? createInterface({ input: child.stdout }) : undefined;
        rl?.on("line", (line) => {
          const msg = parseAcpLine(line);
          if (!msg) return;

          // Incoming notification from agy acp
          if (typeof msg.method === "string" && msg.id === undefined) {
            if (msg.method === "session/update") {
              const params = msg.params as Record<string, unknown> | undefined;
              const update = params?.update;
              if (update && typeof update === "object" && !Array.isArray(update)) {
                updateListener?.(update as AcpSessionUpdate);
              }
            }
            return;
          }

          // Incoming JSON-RPC request from agy acp (e.g. session/request_permission)
          if (typeof msg.method === "string" && msg.id !== undefined) {
            if (msg.method === "session/request_permission") {
              const params = (msg.params ?? {}) as AcpPermissionRequestParams;
              const optionId = selectPermissionOptionId(params);
              writeRaw(
                encodeJsonRpcResponse(msg.id as number | string, {
                  outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
                }),
              );
            }
            return;
          }

          // Response to one of our JSON-RPC requests
          if (msg.id !== undefined) {
            const pending = pendingRpc.get(msg.id as number | string);
            if (!pending) return;
            pendingRpc.delete(msg.id as number | string);
            if (msg.error && typeof msg.error === "object") {
              const errObj = msg.error as Record<string, unknown>;
              const errMessage =
                typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);
              pending.reject(new AgyProcessError({ message: errMessage, stderr: stderrBuffer }));
            } else {
              const result =
                msg.result && typeof msg.result === "object" && !Array.isArray(msg.result)
                  ? (msg.result as Record<string, unknown>)
                  : {};
              pending.resolve(result);
            }
          }
        });

        const close = Effect.sync(() => {
          closed = true;
          rl?.close();
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        });

        // Perform ACP handshake: initialize -> session/new -> set_model -> optional effort
        void (async () => {
          try {
            await sendRequest("initialize", {
              protocolVersion: 1,
              clientCapabilities: {},
              clientInfo: { name: "pi-agy-cli", version: "0.1.0" },
            });

            const newRes = await sendRequest("session/new", {
              cwd: spec.cwd,
              mcpServers: [mcp.mcpServerConfig],
            });
            const sessionId = typeof newRes.sessionId === "string" ? newRes.sessionId : "";
            if (!sessionId) {
              throw new AgyProcessError({
                message: "agy acp session/new did not return a sessionId",
                stderr: stderrBuffer,
              });
            }

            await sendRequest("session/set_model", {
              sessionId,
              modelId: spec.model,
            });

            if (spec.effort) {
              await sendRequest("session/set_config_option", {
                sessionId,
                configId: "thought_level",
                value: spec.effort,
              }).catch(() => {
                // Non-fatal if model/CLI doesn't expose thought_level option.
              });
            }

            resume(
              Effect.succeed({
                id,
                spec,
                sessionId,
                child,
                mcp,
                startPrompt: async (blocks) => {
                  const res = await sendRequest("session/prompt", {
                    sessionId,
                    prompt: blocks,
                  });
                  return {
                    stopReason: mapAcpStopReason(res.stopReason),
                    usage: extractAcpUsage(res.usage),
                  };
                },
                setEffort: async (effort) => {
                  await sendRequest("session/set_config_option", {
                    sessionId,
                    configId: "thought_level",
                    value: effort,
                  }).catch(() => {
                    // Best effort on warm process.
                  });
                },
                cancelPrompt: () => {
                  writeRaw(encodeJsonRpcNotification("session/cancel", { sessionId }));
                },
                setUpdateListener: (cb) => {
                  updateListener = cb;
                },
                setExitListener: (cb) => {
                  exitListener = cb;
                },
                getStderr: () => stderrBuffer,
                close,
              }),
            );
          } catch (err) {
            rl?.close();
            if (!child.killed) child.kill("SIGKILL");
            const procErr =
              err instanceof AgyProcessError
                ? err
                : new AgyProcessError({
                    message: err instanceof Error ? err.message : String(err),
                    stderr: stderrBuffer,
                  });
            resume(Effect.fail(procErr));
          }
        })();
      }),
      (h) => h.close,
    );

    return handle;
  });
}
