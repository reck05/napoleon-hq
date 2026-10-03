# Napoleon HQ

A live war room for Claude Code subagents. Claude ("Napoleon") delegates tasks to agents; HQ draws them as a family tree in real time, shows every prompt and tool call, and lets you send orders to any agent.

- **`mod/orquestador`**: a Claude Code mod (function-hook plugin). Registers one agent type per work area, records agents, tool calls, prompts, live text and token usage into `~/.claude/napoleon/state.json`, and delivers orders queued in `outbox.jsonl`.
- **`server.mjs`**: stdlib Node server on `127.0.0.1:4517`. Serves the app, streams `state.json` over SSE, and queues orders. Orders need the per-run token baked into the page, and a matching Host and Origin.
- **`src/`**: React 19 + React Flow + d3-hierarchy + Motion. Black and white, auto-orienting family tree, inspector with conversation and composer, timeline, command palette (Ctrl+K).

## Run

```bash
npm install
npm run build
npm run serve
```

Open http://localhost:4517 (or `?demo` for a scripted campaign). On Windows, `Napoleon HQ.vbs` starts the server if needed and opens Edge in app mode.

Keys: `F` frame, `T` timeline, `D` demo/live, `Esc` clear, `Ctrl+K` palette.

## Mod

Load `mod/orquestador` with `claude --plugin-dir mod/orquestador`. The state paths and the server path are constants at the top of `hooks/register.tsx`.
