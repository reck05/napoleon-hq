// Napoleon peer bridge: an MCP server (stdio) that lets another agent or account (Codex, a second
// Claude Code, Cursor...) talk to your Claude Code session through Napoleon HQ.
//   NAPOLEON_PEER   the name you appear under in HQ (default "Codex")
//   NAPOLEON_URL    HQ server (default http://127.0.0.1:4517)
// Auth: the local key HQ's server keeps in ~/.claude/napoleon/peer.key (readable only by this Windows user).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const PEER = process.env.NAPOLEON_PEER || 'Codex'
const URL_ = process.env.NAPOLEON_URL || 'http://127.0.0.1:4517'
const KEY_FILE = path.join(os.homedir(), '.claude', 'napoleon', 'peer.key')

const key = () => {
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim() } catch { return '' }
}

async function call(pathname, init = {}) {
  let r
  try {
    r = await fetch(URL_ + pathname, { ...init, headers: { 'content-type': 'application/json', 'x-peer-key': key(), ...(init.headers ?? {}) } })
  } catch {
    throw new Error('Napoleon HQ no responde en ' + URL_ + '. Abre Napoleon HQ o una sesión de Claude Code con el mod orquestador.')
  }
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error ?? `HQ respondió ${r.status}`)
  return body
}

const text = t => ({ content: [{ type: 'text', text: t }] })

// one long-poll round is ~25 s on the server; keep asking until the reply lands or the wait runs out
async function waitReply(id, seconds) {
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) {
    const r = await call(`/api/peer/reply?id=${encodeURIComponent(id)}`)
    if (r.done) return r.text
  }
  return null
}

const server = new McpServer({ name: 'napoleon', version: '0.1.0' })

server.registerTool(
  'ask_claude',
  {
    title: 'Preguntar a Claude (Napoleon)',
    description:
      `Envía un mensaje a la sesión de Claude Code del usuario (el orquestador "Napoleon") y espera su respuesta. ` +
      `Úsalo cuando necesites a Claude: que revise algo, que te dé contexto del trabajo del usuario, o que delegue una tarea a sus agentes ` +
      `(áreas de IMPLICA: deals, originación, encargos, automatización, prescriptores, formación IA, operating value; tiene conectores como PitchBook y SABI). ` +
      `Escribe el mensaje completo y autosuficiente. Firmas como "${PEER}". No incluyas nombres de clientes: usa codenames.`,
    inputSchema: {
      message: z.string().min(1).max(8000).describe('Lo que quieres que Claude haga o responda'),
      wait_seconds: z.number().int().min(0).max(1800).optional().describe('Cuánto esperar la respuesta (por defecto 600). 0 = no esperar.'),
    },
  },
  async ({ message, wait_seconds = 600 }) => {
    const { id } = await call('/api/peer/ask', { method: 'POST', body: JSON.stringify({ from: PEER, text: message }) })
    if (!wait_seconds) return text(`Enviado a Claude (id ${id}). Recoge la respuesta con get_claude_reply.`)
    const reply = await waitReply(id, wait_seconds)
    return text(reply ?? `Claude aún no ha respondido (id ${id}); puede estar ocupado con otra tarea. Vuelve a consultar con get_claude_reply.`)
  },
)

server.registerTool(
  'get_claude_reply',
  {
    title: 'Recoger respuesta de Claude',
    description: 'Recoge la respuesta a un mensaje enviado antes con ask_claude.',
    inputSchema: { id: z.string().min(1), wait_seconds: z.number().int().min(0).max(1800).optional() },
  },
  async ({ id, wait_seconds = 60 }) => text((await waitReply(id, Math.max(1, wait_seconds))) ?? `Sin respuesta todavía para ${id}.`),
)

server.registerTool(
  'claude_status',
  {
    title: 'Estado de Claude',
    description: 'Qué está haciendo la sesión de Claude ahora: agentes en marcha, terminados y su área. Útil antes de pedirle algo.',
    inputSchema: {},
  },
  async () => {
    const s = await call('/api/peer/status')
    if (!s.agents) return text('Napoleon no tiene sesión activa ahora mismo.')
    const lines = s.agents.map(a => `- [${a.status}] ${a.area}: ${a.description}${a.tool ? ` (${a.tool})` : ''}`)
    return text(`Napoleon${s.tool ? ` está usando ${s.tool}` : ''}. ${s.agents.filter(a => a.status === 'running').length} agentes activos de ${s.agents.length}.\n${lines.join('\n')}`)
  },
)

await server.connect(new StdioServerTransport())
