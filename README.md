# Napoleon HQ · Codex

A local headquarters for Codex. Choose a project, give Napoleon an objective and follow its conversation, tools and subagents in real time. The coordinator follows the instructions in `coordinator.md`: focus, clear missions, autonomy, logistics and verification.

- **`codex-bridge.mjs`**: runs Codex App Server over stdio, using your existing Codex login. Streams conversation and tool events and sends objectives, follow-up directions and decisions to Codex. It manages only the sessions created in HQ.
- **`server.mjs`**: Node server on `127.0.0.1:4517`. Serves the app and streams events over SSE. Mutations require the page's per-run token and a matching Host and Origin.
- **`coordinator.md`**: your coordinator instructions, loaded as developer instructions when a project session starts or resumes. Restart HQ after editing it to apply it to loaded sessions.
- **`src/`**: React 19 + React Flow + d3-hierarchy + Motion. Black and white, auto-orienting family tree, inspector with conversation and composer, timeline, command palette (Ctrl+K).

## Run

```bash
npm install
npm run build
npm run serve
```

Open http://localhost:4517. Use **proyectos** to select a local folder, then type your objective in the campaign field. Click Napoleon or a subagent to inspect its conversation. Further messages steer a running campaign or continue the same session. **detener** interrupts the coordinator. Codex requests that require approval or an answer appear in the panel.

Codex CLI must be installed and signed in (`codex login status`). The bundled macOS Codex binary is detected automatically; otherwise HQ uses `codex` on PATH. Override with `CODEX_BIN` if needed. No separate API key is required for an existing ChatGPT login. See the [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

The project catalog is local: `~/.codex/napoleon/projects.json`. Entries contain `id`, `name`, `kind` (`local` or `chatgpt`), `path` and `url`. Local projects use their existing folders. ChatGPT entries are links only; their conversations and files are not imported. A missing local folder is visibly marked unavailable.

HQ saves project/session mappings in `~/.codex/napoleon/bridge.json`; Codex saves the durable conversation. A server restart resumes HQ's selected project and restores its conversation and agent tree. `NAPOLEON_DIR` overrides HQ's data directory. Personal paths and project names are kept outside this repository.

Add `?demo` to the URL to view the scripted demo. Demo messages do not run Codex tasks.

Keys: `F` frame, `T` timeline, `D` demo/live, `Esc` clear, `Ctrl+K` palette.

## Legacy Claude mod

`mod/orquestador` is the original Claude connector, retained as source. The current HQ server uses Codex. The legacy mod still has Windows paths and is not used by this setup. `Napoleon HQ.vbs` is a legacy Windows launcher; on Mac use `npm run serve`.
