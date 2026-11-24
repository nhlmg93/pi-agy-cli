# pi-agy-cli

A pi 1.x provider extension that routes LLM calls through the official Antigravity CLI (`agy`). No build step: pi loads `index.ts` and its TypeScript imports directly.

Modeled on `dmmulroy/pi-claude-cli` with **one** execution path: pi owns the prompt, tools, conversation, and compaction.

## Invariants

1. pi owns the prompt, active tools, complete tool results, and compaction. An `agy` process is a disposable cache of pi's history, never a second conversation ledger.
2. A warm process may continue only when its acknowledged pi-history prefix and launch signature match. Anything else retires it and imports pi's current history into a fresh process.
3. Tool calls reach pi as real `toolCall` blocks; the CLI waits for the matching pi result.
4. CLI sessions do not persist. Trace files hold ids, names, sizes, counts, and durations — never prompt text, tool arguments, or tool results (unless `PI_AGY_CLI_TRACE_WIRE=raw` is explicitly set).
5. Report errors as assistant error events and aborts as aborted. Only `src/provider-runtime.ts` and `index.ts` end a pi stream.

## Conventions

- **Lazy Effect 4:** `index.ts` and what it imports eagerly (`account-models`, `cli-auth`, `event-bridge`, `provider-env`, `thinking-config`, `terminal-event`) must NOT import `effect`.
- **Vite+:** `vite.config.ts` configures `oxfmt`, type-aware `oxlint`, and tests (`vite-plus/test`).
- **Node 22.18+ type stripping:** ES modules with `.ts` import specifiers. No enums, namespaces, or parameter properties.
- **Narrow imports:** Import `@effect/platform-node-shared` by narrow entrypoint, never its barrel.
- **No `any` outside `tests/`:** Decode unknown input with `Schema` at the boundary.
- **macOS / Linux only:** Windows is not supported.
