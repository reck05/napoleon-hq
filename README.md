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

## Phone and multiple computers

Use **Computadoras → Mi teléfono** for a private access link and QR code, then add the panel to your phone's home screen. **Computadoras** selects the machine that receives your objectives. Pair another HQ with its private HTTPS address and the code revealed on that computer. The current destination is always displayed; an unavailable computer returns an error, and a changed destination rejects a stale objective.

Follow the [three-step Spanish setup guide](docs/mobile-setup.md). The double-click installers in `scripts/` build HQ and register automatic startup on macOS or Windows. Personal configuration and pairing keys remain outside this repository. This Mac's service can stay awake on AC power while the screen sleeps; an entirely powered-off computer must start or wake before it can execute work.

Tailscale Serve publishes HTTPS inside your private network. HQ still binds to loopback. Configure the exact HTTPS origin with `NAPOLEON_PUBLIC_URL` or `~/.codex/napoleon/mobile.json`; mobile access requires a separate private code, an HttpOnly cookie, and the page's CSRF token for actions. Never expose this server directly to the public Internet. The managed service finishes HTTPS setup after your Tailscale login and restarts only HQ to apply it.

## Legacy Claude mod

The original Claude mode and peer MCP bridge are also available:

```bash
npm run serve -- --engine=claude
```

This mode reads `~/.claude/napoleon/state.json`, queues orders for the Claude mod, and supports `ask_claude`, `get_claude_reply` and `claude_status` through `peer-mcp.mjs`. Each peer appears as a dashed node with its conversation. `NAPOLEON_ENGINE=claude` selects the same mode. Codex remains the default.

Load the Claude mod with `claude --plugin-dir mod/orquestador`. The mod still contains Windows paths at the top of `hooks/register.tsx`; configure these for your machine before using it. Its automatic server launch selects Claude mode explicitly. On Mac use `npm run serve`; `Napoleon HQ.vbs` is the Windows launcher.

## Peers: other agents and accounts

`peer-mcp.mjs` lets an MCP client talk to the Claude session. Authentication uses the local key in `~/.claude/napoleon/peer.key`. This interface requires Claude mode and will reject requests to a Codex coordinator rather than send them to the wrong engine.

Example for Codex (`~/.codex/config.toml`), replacing the path with your checkout:

```toml
[mcp_servers.napoleon]
command = "node"
args = ["/absolute/path/to/napoleon-hq/peer-mcp.mjs"]
tool_timeout_sec = 1800

[mcp_servers.napoleon.env]
NAPOLEON_PEER = "Codex"
```

Another Claude account: `claude mcp add napoleon -e NAPOLEON_PEER="Claude 2" -- node /absolute/path/to/napoleon-hq/peer-mcp.mjs`.

For a custom data directory set `NAPOLEON_PEER_KEY_FILE` to the matching `peer.key` file. `NAPOLEON_URL` selects a different HQ port or address.
