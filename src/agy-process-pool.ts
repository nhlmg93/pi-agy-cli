/**
 * Warm process pool for `agy acp` subprocesses: leases, parking, cap, and
 * non-blocking background retirement.
 */

import type { Tool } from "@earendil-works/pi-ai";
import { Effect, Exit, Scope } from "effect";
import type { AgyLaunchSpec } from "./agy-cli.ts";
import { spawnAgyProcess, type AcpPromptOutcome, type AgyProcessHandle } from "./agy-process.ts";
import type { AgyProcessError } from "./errors.ts";
import type { AgyEffortLevel } from "./thinking-config.ts";

export interface ParkedProcess {
  readonly handle: AgyProcessHandle;
  readonly scope: Scope.Closeable;
  readonly acknowledgedPrefixLength: number;
  readonly pendingToolCallIds: readonly string[];
  readonly activePrompt?: Promise<AcpPromptOutcome>;
  readonly lastEffort?: AgyEffortLevel;
}

export interface ProcessPool {
  readonly take: (sessionKey: string) => Effect.Effect<ParkedProcess | undefined>;
  readonly launch: (
    spec: AgyLaunchSpec,
    tools?: readonly Tool[],
  ) => Effect.Effect<ParkedProcess, AgyProcessError>;
  readonly park: (sessionKey: string, parked: ParkedProcess) => Effect.Effect<void>;
  readonly retireInBackground: (parked: ParkedProcess) => Effect.Effect<void>;
  readonly shutdown: () => Effect.Effect<void>;
}

interface Refable {
  unref?: () => void;
  ref?: () => void;
}

function setProcessRef(parked: ParkedProcess, keepAlive: boolean): void {
  const { child, mcp } = parked.handle;
  const targets: readonly (Refable | null | undefined)[] = [
    child,
    child.stdin as Refable | null,
    child.stdout as Refable | null,
    child.stderr as Refable | null,
  ];
  for (const target of targets) {
    if (keepAlive) target?.ref?.();
    else target?.unref?.();
  }
  if (keepAlive) mcp.ref();
  else mcp.unref();
}

export function makeProcessPool(cap: number): ProcessPool {
  const parkedBySession = new Map<string, ParkedProcess>();

  const killAllSync = (): void => {
    for (const parked of parkedBySession.values()) {
      if (!parked.handle.child.killed) {
        parked.handle.child.kill("SIGKILL");
      }
      void parked.handle.mcp.close();
    }
    parkedBySession.clear();
  };

  process.once("exit", killAllSync);

  const retireInBackground = (parked: ParkedProcess): Effect.Effect<void> =>
    Effect.forkDetach(Scope.close(parked.scope, Exit.void)).pipe(Effect.asVoid);

  const take = (sessionKey: string): Effect.Effect<ParkedProcess | undefined> =>
    Effect.sync(() => {
      const existing = parkedBySession.get(sessionKey);
      if (existing) {
        parkedBySession.delete(sessionKey);
        setProcessRef(existing, true);
      }
      return existing;
    });

  const launch = (
    spec: AgyLaunchSpec,
    tools: readonly Tool[] = [],
  ): Effect.Effect<ParkedProcess, AgyProcessError> =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const handle = yield* spawnAgyProcess(spec, tools).pipe(Scope.provide(scope));
      return {
        handle,
        scope,
        acknowledgedPrefixLength: 0,
        pendingToolCallIds: [],
        lastEffort: spec.effort,
      };
    });

  const park = (sessionKey: string, parked: ParkedProcess): Effect.Effect<void> =>
    Effect.gen(function* () {
      const evicted = parkedBySession.get(sessionKey);
      if (evicted) {
        yield* retireInBackground(evicted);
      }
      parkedBySession.set(sessionKey, parked);
      setProcessRef(parked, false);

      while (parkedBySession.size > cap) {
        const oldestKey = parkedBySession.keys().next().value;
        if (oldestKey === undefined) break;
        const oldest = parkedBySession.get(oldestKey);
        parkedBySession.delete(oldestKey);
        if (oldest) {
          yield* retireInBackground(oldest);
        }
      }
    });

  const shutdown = (): Effect.Effect<void> => Effect.sync(killAllSync);

  return {
    take,
    launch,
    park,
    retireInBackground,
    shutdown,
  };
}
