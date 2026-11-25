# Test-Driven Implementation Plan for `pi-agy-cli`

## Context

`pi-agy-cli` is scaffolded on the `dmmulroy/pi-claude-cli` architecture (Effect 4, Vite+, Node 22.18+ native type stripping, lazy Effect runtime). To drive the real implementation with high confidence — without spending tokens on every run — we will port `dmmulroy/pi-claude-cli`'s 4-layer testing architecture to `pi-agy-cli` first, then implement and refine `src/` until every test, scenario, and e2e check passes.

## Approach

Follow a strict **tests-first, then implement-to-green** workflow:

1. **Hermetic Test Setup:** Add `tests/setup-env.ts` (clears `PI_AGY_CLI_*` ambient env vars) and wire it into `vite.config.ts` (`test.setupFiles`) alongside coverage thresholds on pure modules.
2. **Pure Module Unit Tests (`tests/*.test.ts`):** Write comprehensive `vite-plus/test` suites for every pure module (`account-models`, `agy-cli`, `cli-auth`, `cli-protocol`, `episode-mode`, `event-bridge`, `pi-context`, `provider-env`, `thinking-config`, `tool-mapping`).
3. **Deterministic Stub CLI (`tests/e2e/agy-stub.cjs`):** Upgrade the stub to support keyword-driven behaviors matching `dmmulroy/pi-claude-cli`'s `claude-stub.cjs`:
   - `default` → streams `"PORT-OK"` and ends turn
   - `think` → streams thinking block then `"PORT-OK"`
   - `tool:<name>` / `tools:<a>,<b>` → emits tool call(s), waits for handoff result, streams `"TOOL-DONE <result>"`
   - `die` → writes to stderr and exits non-zero
   - `failturn` → emits an error turn result
   - `hang` → starts a message and never finishes (for timeout/abort testing)
   - `models` / `--help` → deterministic CLI discovery responses
4. **Effect-Service Scenario Suite (`scripts/scenarios.ts` & `scripts/scenarios/driver.ts`):** Run real `ProviderRuntime`, `runEpisode`, and `ProcessPool` against `tests/e2e/agy-stub.cjs` in an isolated `XDG_STATE_HOME`, asserting stream outputs, warm-process reuse (PID stability), background retirement, tool handoff, error/abort handling, and emitted NDJSON trace spans.
5. **Real-Pi E2E Smoke (`scripts/e2e-stub.sh`):** Prepend a temp `STUB_DIR` containing `agy` (copied from `tests/e2e/agy-stub.cjs`) to `PATH`, isolate `XDG_STATE_HOME`, run `pi -ne -e "$EXT_DIR" -p --model "pi-agy-cli/gemini-4-neon" "magic word" </dev/null`, and assert `PORT-OK`.
6. **Implement to Green:** Install dependencies (`pnpm install` / `vp install`) and implement/refine `src/` and `index.ts` until `vp run ready` (`vp check && vp test run && vp run test:scenarios && vp run test:e2e`) passes with zero errors.

## Files to Modify / Create

### Test & Harness Files

- `vite.config.ts` — add `setupFiles: ["tests/setup-env.ts"]` and coverage thresholds
- `tests/setup-env.ts` — strip `PI_AGY_CLI_*` env vars before tests
- `tests/account-models.test.ts`
- `tests/agy-cli.test.ts`
- `tests/cli-auth.test.ts`
- `tests/cli-protocol.test.ts`
- `tests/episode-mode.test.ts`
- `tests/event-bridge.test.ts`
- `tests/pi-context.test.ts`
- `tests/provider-env.test.ts`
- `tests/thinking-config.test.ts`
- `tests/tool-mapping.test.ts`
- `tests/e2e/agy-stub.cjs` — full keyword-driven deterministic CLI stub
- `scripts/scenarios.ts` & `scripts/scenarios/driver.ts` — Effect-service scenario runner
- `scripts/e2e-stub.sh` — real `pi -ne -e` smoke test against `agy-stub.cjs`

### Implementation Files (driven by tests)

- `index.ts` — ensure `registerApiProvider` / print-mode compatibility and lazy runtime loading
- `src/agy-cli.ts`, `src/cli-protocol.ts`, `src/agy-process.ts`, `src/agy-process-pool.ts`
- `src/episode-mode.ts`, `src/episode.ts`, `src/event-bridge.ts`, `src/pi-context.ts`
- `src/tool-mapping.ts`, `src/mcp-inband.ts`, `src/provider-runtime.ts`, `src/tracing.ts`

## Reuse

- Existing scaffolded modules in `src/` (`src/account-models.ts`, `src/agy-cli.ts`, `src/cli-protocol.ts`, `src/episode-mode.ts`, `src/event-bridge.ts`, `src/pi-context.ts`, `src/provider-env.ts`, `src/thinking-config.ts`, `src/tool-mapping.ts`, `src/tracing.ts`).
- `vite.config.ts` and `package.json` scripts (`ready`, `test:scenarios`, `test:e2e`, `trace`).
- Patterns from `dmmulroy/pi-claude-cli` (`tests/setup-env.ts`, `scripts/e2e-stub.sh`, `tests/e2e/claude-stub.cjs`).

## Steps

- [x] 1. Add `tests/setup-env.ts` and update `vite.config.ts` with `setupFiles` and coverage thresholds
- [x] 2. Write pure-module unit tests (`tests/account-models.test.ts`, `tests/agy-cli.test.ts`, `tests/cli-auth.test.ts`, `tests/cli-protocol.test.ts`, `tests/provider-env.test.ts`, `tests/thinking-config.test.ts`)
- [x] 3. Write core bridge & context unit tests (`tests/episode-mode.test.ts`, `tests/event-bridge.test.ts`, `tests/pi-context.test.ts`, `tests/tool-mapping.test.ts`)
- [x] 4. Upgrade `tests/e2e/agy-stub.cjs`, `scripts/scenarios.ts` (+ `scripts/scenarios/driver.ts`), and `scripts/e2e-stub.sh`
- [x] 5. Install dependencies and implement/refine `src/` and `index.ts` until `vp run ready` passes completely

## Verification

- `vp check` (oxfmt + type-aware oxlint + typecheck) passes with zero errors.
- `vp test run` passes all unit tests with coverage thresholds met.
- `vp run test:scenarios` passes all stubbed Effect-service scenarios and trace assertions.
- `vp run test:e2e` passes the real `pi -ne -e .` smoke test against `tests/e2e/agy-stub.cjs`.
