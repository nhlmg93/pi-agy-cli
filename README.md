# pi-agy-cli

Use Antigravity (`agy`) models in [pi](https://github.com/earendil-works/pi). The official Antigravity CLI (`agy`) handles authentication and model communication; pi owns the prompt, tools, conversation history, and compaction.

Modeled on [`dmmulroy/pi-claude-cli`](https://github.com/dmmulroy/pi-claude-cli) on Effect 4 with Vite+ tooling.

## Requirements

- macOS or Linux
- Node 22.18+
- `agy` CLI installed and authenticated on `PATH`

## Development

```bash
vp install                 # pnpm via Vite+
vp run ready               # check, unit tests, scenarios, e2e
vp run trace -- tree --last
```

## Architecture

- `index.ts` — Effect-free extension entry point registering the `pi-agy-cli` provider
- `src/provider-runtime.ts` — Effect runtime boundary (one fiber per call, single terminal event)
- `src/episode.ts` & `src/episode-mode.ts` — Episode orchestration (`turn | handoff | spawn`)
- `src/agy-process-pool.ts` & `src/agy-process.ts` — Scoped warm CLI process pool with leases & background retirement
- `src/agy-cli.ts` & `src/cli-protocol.ts` — `agy -p --input-format stream-json --output-format stream-json` launch & NDJSON schema
- `src/event-bridge.ts` — CLI stream events → pi `AssistantMessageEventStream`
- `src/mcp-inband.ts` & `src/tool-mapping.ts` — Pi tool bridging
- `src/tracing.ts` & `scripts/trace.ts` — Content-free NDJSON span tracing
