# pi-agy-cli Scaffolding Plan (Modeled on `dmmulroy/pi-claude-cli`)

## Context

Build `pi-agy-cli`, a pi 1.x provider extension modeled on [`dmmulroy/pi-claude-cli`](https://github.com/dmmulroy/pi-claude-cli) (`@saccolabs/pi-claude-cli` v0.12.0), that runs Antigravity (`agy`) models through the official `agy` CLI while letting pi own the prompt, tools, conversation history, and compaction.

---

## Reference Research: `dmmulroy/pi-claude-cli`

### 1. Tech Stack

- **Runtime & Language:** TypeScript 7 (`ESNext`, `moduleResolution: "bundler"`, `strict: true`, `allowImportingTsExtensions: true`), ES modules (`"type": "module"`), Node 22.18+ native type stripping (no build step; pi loads `index.ts` directly; no enums, namespaces, or parameter properties).
- **Effect 4:** `effect@4.0.3` and `@effect/platform-node-shared@4.0.3` (imported by narrow entrypoints, never barrel). Strictly **lazy-loaded** on the first model call so `index.ts` and eager modules stay Effect-free (avoiding ~135 ms / 60 MB on every pi startup).
- **Tooling (Vite+):** `vite-plus@1.2.0` (`vp check`, `vp test run`, `oxfmt`, type-aware `oxlint`, `vite-plus/test`, `@vitest/coverage-v8`), `pnpm@12.14.0` (kept npm-installable for `pi install`).
- **Pi 1.x SDK:** `@earendil-works/pi-ai` (`1.2.0`), `@earendil-works/pi-coding-agent` (`1.2.0`), `typebox`.
- **Platform:** macOS / Linux only (no Windows support).

### 2. Core Architecture & Feature Set

- **Single Execution Path:** pi owns prompt, tools, history, and compaction; CLI processes are disposable warm caches (never a second conversation ledger, no `--resume` transcripts).
- **Episode Model (`episode.ts`, `episode-mode.ts`):** Each pi model call is one episode: `pool.take(session)` → pure choice of `turn | handoff | spawn` → stream CLI events to pi → `pool.park(lease, proc)` or `pool.retireInBackground`.
- **Warm Process Pool (`claude-process-pool.ts`, `claude-process.ts`):** Scoped Effect resources with leases, parking, cap, and non-blocking background retirement.
- **Held-Open In-Band Tool Calls (`mcp-inband.ts`):** Exposes pi's tools over the CLI's control channel (no extra process/socket). When the model calls a tool, `tools/call` stays open while pi executes it, then the next `handoff` episode answers it.
- **Boundary & Terminal Guarantee (`provider-runtime.ts`, `terminal-event.ts`, `errors.ts`):** One Effect fiber per call, guaranteed single terminal event, tagged errors, layers never fail.
- **Zero-Latency Startup Caches (`account-models.ts`, `cli-auth.ts`, `cli-update.ts`, `model-probe.ts`):** Disk-cached auth/update/model status refreshed in the background.
- **Content-Free Tracing (`tracing.ts`, `trace-location.ts`, `scripts/trace.ts`):** NDJSON span sink in `~/.local/state/<pkg>/traces/<date>.ndjson` (0600, 7-day pruning) + `vp run trace`.
- **Offline Verification (`scripts/scenarios.ts`, `tests/e2e/claude-stub.cjs`, `scripts/e2e-stub.sh`):** Deterministic stub CLI + trace-asserting scenarios.

---

## Scaffolding Plan for `pi-agy-cli`

Mirror `dmmulroy/pi-claude-cli`'s exact stack, invariants, and module layout, adapted to `agy`:

- **CLI target:** `agy -p --input-format stream-json --output-format stream-json --disable-slash-commands` (with `--model`, `--effort low|medium|high|xhigh|max`, `--settings`) and `agy models` for model discovery.
- **Provider ID:** `pi-agy-cli` (with `/pi-agy-cli-status` command).
- **Lazy Effect boundary:** Keep `index.ts` and eager helpers (`account-models.ts`, `cli-auth.ts`, `event-bridge.ts`, `provider-env.ts`, `thinking-config.ts`, `terminal-event.ts`) completely free of `effect` imports.

### Directory & File Structure

```
pi-agy-cli/
├── package.json                  # @earendil-works/pi-* peers, effect@4.0.3, vite-plus, scripts (ready, trace, test:scenarios, test:e2e)
├── tsconfig.json                 # Strict ESNext/bundler, allowImportingTsExtensions: true
├── vite.config.ts                # Vite+ config (oxfmt, type-aware oxlint, vitest)
├── .node-version                 # 22.18+
├── .gitignore                    # node_modules, coverage, *.log
├── AGENTS.md                     # Architecture invariants & coding conventions
├── README.md                     # Quick start, architecture overview, dev commands
├── index.ts                      # Eager, Effect-free pi extension entry point (pi.registerProvider)
├── src/
│   ├── account-models.ts         # Dynamic `agy models` parsing + fallback catalog (Effect-free)
│   ├── cli-auth.ts               # Disk-cached agy auth/availability probe (Effect-free)
│   ├── cli-protocol.ts           # Schema-decoded agy stream-json NDJSON protocol types
│   ├── agy-cli.ts                # Launch flags, env sanitization, binary resolution
│   ├── agy-process.ts            # Single scoped agy CLI process (Effect Scope)
│   ├── agy-process-pool.ts       # Leases, warm parking, cap, retireInBackground
│   ├── episode-mode.ts           # Pure decision: turn | handoff | spawn
│   ├── episode.ts                # Single model call orchestration
│   ├── event-bridge.ts           # agy stream events -> pi AssistantMessageEventStream (Effect-free)
│   ├── mcp-inband.ts             # Pi tools bridged to agy (protocol-dependent stub/adapter)
│   ├── model-probe.ts            # Lazy Effect-backed `agy models` / `agy --version` probe
│   ├── pi-context.ts             # pi history -> structured or flat prompt import
│   ├── provider-config.ts        # Config service
│   ├── provider-env.ts           # Env resolution (Effect-free)
│   ├── provider-runtime.ts       # Effect runtime boundary: one fiber per call, one terminal event
│   ├── terminal-event.ts         # Single terminal event helper (Effect-free)
│   ├── thinking-config.ts        # pi ThinkingLevel -> agy --effort mapping (Effect-free)
│   ├── tool-mapping.ts           # Tool name/arg mapping & IDs
│   ├── errors.ts                 # Effect Data.TaggedError types
│   ├── trace-location.ts         # ~/.local/state/pi-agy-cli/traces path resolution
│   └── tracing.ts                # Content-free NDJSON span sink
├── scripts/
│   ├── trace.ts                  # CLI to inspect traces (tree, stats, open)
│   ├── scenarios.ts              # Deterministic stub scenario runner
│   └── e2e-stub.sh               # `pi -ne -e .` smoke test against stub CLI
└── tests/
    └── e2e/
        └── agy-stub.cjs          # Deterministic stand-in for `agy` CLI
```

## Steps

- [x] 1. Scaffold root config (`package.json`, `tsconfig.json`, `vite.config.ts`, `.node-version`, `.gitignore`, `AGENTS.md`, `README.md`)
- [x] 2. Scaffold Effect-free eager layer (`index.ts`, `src/account-models.ts`, `src/cli-auth.ts`, `src/provider-env.ts`, `src/thinking-config.ts`, `src/terminal-event.ts`, `src/event-bridge.ts`)
- [x] 3. Scaffold Effect 4 core runtime & process pool (`src/errors.ts`, `src/provider-config.ts`, `src/cli-protocol.ts`, `src/agy-cli.ts`, `src/agy-process.ts`, `src/agy-process-pool.ts`)
- [x] 4. Scaffold episode execution & bridging (`src/episode-mode.ts`, `src/episode.ts`, `src/pi-context.ts`, `src/tool-mapping.ts`, `src/mcp-inband.ts`, `src/model-probe.ts`, `src/provider-runtime.ts`)
- [x] 5. Scaffold tracing & offline verification harness (`src/trace-location.ts`, `src/tracing.ts`, `scripts/trace.ts`, `scripts/scenarios.ts`, `scripts/e2e-stub.sh`, `tests/e2e/agy-stub.cjs`)

## Verification

1. `vp install` (or `pnpm install`) and `vp check` (oxfmt + oxlint + typecheck) pass cleanly.
2. `index.ts` has zero eager `effect` imports.
3. Probe `agy -p --input-format stream-json --output-format stream-json` wire format in a follow-up spike to finalize `src/cli-protocol.ts` and `src/mcp-inband.ts`.
