import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import type { AgentRow, View, Feed, LogEntry, Msg } from '../types'

const PANE = 'orquestador'
const BOSS = 'Napoleon'
const ROOT = '__root'
const view = atom({ plugin: 'orquestador', key: 'view' } as const, { agents: [], mainCalls: 0 } as View)
const feed = atom({ plugin: 'orquestador', key: 'feed' } as const, { sessionStart: 0, main: [], logs: {}, answers: {}, usage: {}, convo: {}, pending: [], lastSeq: 0, peers: {} } as Feed)

// ponytail: fixed paths shared with napoleon-hq/server.mjs; a userConfig option if this ever runs on another machine
const DIR = 'C:/Users/Usuario/.claude/napoleon'
const STATE_FILE = `${DIR}/state.json`
const OUTBOX = `${DIR}/outbox.jsonl`
const REPLIES = `${DIR}/replies`
const SERVER = 'C:/Users/Usuario/Documents/napoleon-hq/server.mjs'
const HQ_URL = 'http://localhost:4517'

const RULES = `Trabajas para un analista de IMPLICA Corporate Finance (M&A, Debt Advisory, Operating Value).
Reglas: nunca inventes cifras, múltiplos ni compradores (márcalo como pendiente); cita la fuente de cada dato;
usa codenames de proyecto, nunca nombres de cliente fuera del mandato; aplica la marca IMPLICA a los entregables.
Nunca envíes correos ni mensajes: deja borradores. Al terminar, responde en 3-5 líneas: qué hiciste,
dónde quedó cada archivo (ruta completa) y qué queda pendiente.`

// one agent type per sheet of "Plan de trabajo IMPLICA.xlsx"
const AREAS: { name: string; label: string; description: string; focus: string }[] = [
  { name: 'deals', label: 'Deals', description: 'Tareas de mandatos en curso: organizar documentos y carpetas del deal, subir transcripciones y notas de reuniones, listas de compradores de un build-up.', focus: 'Ordena con cuidado las carpetas del deal sin borrar nada. Para compradores usa la skill buscar-compradores-implica.' },
  { name: 'originacion', label: 'Originación', description: 'Originación comercial: fichas comerciales, compradores potenciales, targets en SABI, ranking de sectores, análisis de mercado para fondos.', focus: 'Usa las skills ficha-comercial-ma, buscar-compradores-implica, deal-origination, analisis-completo-implica y mapa-sectorial-implica según la tarea.' },
  { name: 'encargos', label: 'Encargos', description: 'Encargos puntuales de socios: one-pagers, infografías, propuestas comerciales, revisar un correo o un Excel y preparar la respuesta.', focus: 'Para one-pagers usa infografias-ma; para PDFs implica-pdf-style. Las respuestas a correos van como borrador.' },
  { name: 'automatizacion', label: 'Automatización', description: 'Automatizaciones: skills nuevas, Deal Lander, CRM, conexión con SABI o PitchBook, guía del proceso de mandato.', focus: 'Trabajo de código y skills. Para skills nuevas usa skill-creator. No hagas push ni despliegues sin que el analista lo pida.' },
  { name: 'prescriptores', label: 'Prescriptores', description: 'Prescriptores: criterios para identificarlos, análisis de perfiles, listas de candidatos, newsletter y presentaciones para prescriptores.', focus: 'Investigación y redacción. No contactes a nadie: entrega listas y borradores.' },
  { name: 'formacion', label: 'Formación IA', description: 'Brain y formación IA: playbooks de seguridad IA, diseño de sesiones de formación, píldoras y auditorías de uso de IA.', focus: 'Para píldoras usa pildora-formacion-implica.' },
  { name: 'ov', label: 'Operating Value', description: 'Operating Value: diagnósticos operativos, herramientas de costes, fichas OV e informes OBR.', focus: 'Usa ficha-comercial-ov o informe-obr-operating-value según la tarea.' },
]
const areaOf = (type: string) => AREAS.find(a => `orquestador:${a.name}` === type)
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

const pushMsg = (f: Feed, id: string, m: Msg): Feed => ({ ...f, convo: { ...f.convo, [id]: [...(f.convo[id] ?? []), m].slice(-40) } })

// ---- agents ----
// ponytail: polls $.agent.list() every second but only writes when the list changed, so nothing redraws while idle
async function refresh($: EngineInterface) {
  const [list, now] = await Promise.all([$.agent.list(), $.clock.now()])
  let born: AgentRow[] = []
  await update($, view, v => {
    const old = new Map(v.agents.map(a => [a.id, a]))
    const agents = list.map(info => {
      const prev = old.get(info.id)
      return {
        id: info.id,
        type: info.type,
        area: areaOf(info.type)?.label ?? info.type,
        name: info.name,
        description: info.description,
        status: info.status,
        parentId: info.parentId,
        tool: prev?.tool,
        calls: prev?.calls ?? 0,
        startedAt: prev?.startedAt ?? now,
        endedAt: info.status !== 'running' ? (prev?.endedAt ?? now) : undefined,
      }
    })
    born = agents.filter(a => !old.has(a.id))
    return JSON.stringify(agents) === JSON.stringify(v.agents) ? v : { ...v, agents }
  })
  // hand each newborn the prompt its Agent call carried
  if (born.length) {
    await update($, feed, f => {
      let next = f
      for (const a of born) {
        const i = next.pending.findIndex(p => p.description === a.description)
        if (i < 0) continue
        const p = next.pending[i]
        next = pushMsg({ ...next, pending: next.pending.filter((_, k) => k !== i) }, a.id, { t: p.t, from: a.parentId ? 'agente padre' : BOSS, text: p.text })
      }
      return next
    })
  }
  queueWrite($)
}

// ---- Napoleon HQ feed: one JSON snapshot, rewritten at most every 200 ms ----
const voices = new Map<string, string>() // agentId ('' = Napoleon) -> last streamed text; module-level on purpose (too hot for $.state)
const fromHQ = new Set<string>() // texts this mod is sending, so the session.send hook can tell them from the model's
let isWriteQueued = false

function detailOf(e: Record<string, unknown>): string | undefined {
  for (const k of ['description', 'file_path', 'pattern', 'query', 'command', 'url', 'skill', 'subagent_type', 'path', 'to', 'prompt']) {
    const val = e[k]
    if (typeof val === 'string' && val.trim()) return cut(val.replace(/\s+/g, ' ').trim(), 140)
  }
  return undefined
}

function queueWrite($: EngineInterface) {
  if (isWriteQueued) return
  isWriteQueued = true
  $.clock.after(200, () => {
    isWriteQueued = false
    void (async () => {
      const [v, f, now] = await Promise.all([read($, view), read($, feed), $.clock.now()])
      const snapshot = {
        v: 1,
        updatedAt: now,
        sessionStart: f.sessionStart,
        napoleon: { tool: v.main, calls: v.mainCalls, log: f.main, voice: voices.get('') ?? '', usage: f.usage[''], convo: f.convo[''] ?? [] },
        peers: Object.entries(f.peers ?? {}).map(([name, p]) => ({ name, ...p })),
        agents: v.agents.map(a => ({
          ...a,
          areaKey: areaOf(a.type)?.name ?? 'otros',
          log: f.logs[a.id] ?? [],
          voice: voices.get(a.id) ?? '',
          answer: f.answers[a.id],
          usage: f.usage[a.id],
          convo: f.convo[a.id] ?? [],
        })),
      }
      await $.fs.write(STATE_FILE, JSON.stringify(snapshot)).catch(() => undefined)
    })()
  })
}

// ---- orders typed in HQ: server.mjs appends them to the outbox, this delivers them ----
type Order = { seq: number; to: string; text: string; t: number; from?: string }

// the order whose answer Napoleon's next main-loop turn is: its reply goes back to HQ or to the peer that asked
let awaiting: { seq: number; from: string } | undefined
let isDelivering = false

async function deliverOrders($: EngineInterface) {
  if (isDelivering) return
  isDelivering = true
  try { await deliverOrdersOnce($) } finally { isDelivering = false }
}

async function deliverOrdersOnce($: EngineInterface) {
  const raw = await $.fs.read(OUTBOX).catch(() => '')
  if (!raw) return
  const { lastSeq } = await read($, feed)
  const orders = raw.split('\n').flatMap(l => { try { return [JSON.parse(l) as Order] } catch { return [] } }).filter(o => o.seq > lastSeq)
  for (const o of orders) {
    await update($, feed, f => ({ ...f, lastSeq: Math.max(f.lastSeq, o.seq) })) // mark first: an order is never delivered twice
    const text = o.text.trim()
    if (!text) continue
    if (o.to === 'napoleon') {
      const from = o.from ?? 'tú'
      const isPeer = !!o.from
      if (isPeer) await update($, feed, f => ({ ...f, peers: { ...f.peers, [from]: { firstSeen: f.peers?.[from]?.firstSeen ?? o.t, lastSeen: o.t, isWaiting: true, count: (f.peers?.[from]?.count ?? 0) + 1 } } }))
      await update($, feed, f => pushMsg(f, '', { t: o.t, from, text, status: 'en cola' }))
      queueWrite($)
      // resolves as the turn starts; that turn's turn.complete is the reply
      await $.prompt.submit({
        text: isPeer
          ? `[Mensaje de ${from} vía Napoleon HQ] ${text}

(Tu próxima respuesta se le reenviará a ${from} tal cual: respóndele directamente.)`
          : `[Orden desde Napoleon HQ] ${text}`,
      })
      awaiting = { seq: o.seq, from }
    } else {
      const { agents } = await read($, view)
      const a = agents.find(x => x.id === o.to)
      fromHQ.add(text)
      const sent = await $.session.send({ to: { agentId: o.to }, text }).catch(() => ({ isDelivered: false as const, reason: 'no se pudo enviar' }))
      fromHQ.delete(text)
      if (sent.isDelivered) {
        await update($, feed, f => pushMsg(f, o.to, { t: o.t, from: 'tú', text, status: 'entregado' }))
      } else {
        // the agent is gone: Napoleon decides whether to resume or relaunch it
        await $.prompt.submit({ text: `[Orden desde Napoleon HQ para el agente «${a?.description ?? o.to}» (${o.to})] ${text}\nNo he podido entregárselo directamente (${sent.reason ?? 'sin motivo'}): retómalo con SendMessage o relánzalo.` })
        await update($, feed, f => pushMsg(f, o.to, { t: o.t, from: 'tú', text, status: 'vía Napoleon' }))
      }
    }
    queueWrite($)
  }
}

// ---- the pane: a quiet text tree and the door to HQ ----
function treeLines(v: View): string[] {
  const done = v.agents.filter(a => a.status !== 'running').slice(-8)
  const shown = v.agents.filter(a => a.status === 'running' || done.includes(a))
  const ids = new Set(shown.map(a => a.id))
  const kids = new Map<string, AgentRow[]>()
  for (const a of shown) {
    const p = a.parentId && ids.has(a.parentId) ? a.parentId : ROOT
    kids.set(p, [...(kids.get(p) ?? []), a])
  }
  const lines = [`${BOSS}${v.main ? `  ·  ${v.main}` : ''}`]
  const walk = (id: string, pre: string) => {
    const ks = kids.get(id) ?? []
    ks.forEach((a, i) => {
      const last = i === ks.length - 1
      const mark = a.status === 'running' ? '●' : a.status === 'completed' ? '○' : '×'
      const tool = a.status === 'running' && a.tool ? `  ·  ${a.tool}` : ''
      lines.push(`${pre}${last ? '└─' : '├─'} ${mark} ${a.description}${tool}`)
      walk(a.id, pre + (last ? '   ' : '│  '))
    })
  }
  walk(ROOT, '')
  return lines
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'orquestador', description: 'Abrir el árbol de agentes de Napoleon' })
    for (const a of AREAS) {
      await $.agent.register({ name: a.name, description: a.description, prompt: `${RULES}\n\nÁrea: ${a.label}. ${a.focus}` })
    }
    const now = await $.clock.now()
    await update($, feed, f => ({ ...f, sessionStart: f.sessionStart || now, convo: f.convo ?? {}, pending: f.pending ?? [], lastSeq: f.lastSeq || now * 1000 }))
    // HQ server for the session's life, unless one already answers
    const isUp = await $.http.fetch(`${HQ_URL}/api/health`).then(r => r.ok, () => false)
    if (!isUp) {
      void (async () => {
        for await (const _ of $.process.spawn({ argv: ['node', SERVER] })) { /* the loop is the server's life */ }
      })().catch(() => undefined)
    }
    void $.ui.open({ id: PANE, title: BOSS })
    $.clock.every(1000, () => void refresh($))
    $.clock.every(1000, () => void deliverOrders($))
    queueWrite($)
    return next(e)
  })

  on('command.run', { command: 'orquestador' }, async $ => {
    await $.ui.open({ id: PANE, title: BOSS })
    return { text: `${BOSS} abierto. Vista completa: ${HQ_URL}` }
  })

  on('tool.call', async ($, e, next) => {
    const label = e.tool === 'Agent' ? 'delegando' : e.tool.replace(/^mcp__[^_]+__/, '')
    const now = await $.clock.now()
    await update($, view, v =>
      e.agentId
        ? { ...v, agents: v.agents.map(a => (a.id === e.agentId ? { ...a, tool: label, calls: a.calls + 1 } : a)) }
        : { ...v, main: label, mainCalls: v.mainCalls + 1 },
    )
    const entry: LogEntry = { t: now, tool: label, detail: detailOf(e as unknown as Record<string, unknown>) }
    await update($, feed, f => {
      const logged = e.agentId
        ? { ...f, logs: { ...f.logs, [e.agentId]: [...(f.logs[e.agentId] ?? []), entry].slice(-60) } }
        : { ...f, main: [...f.main, entry].slice(-60) }
      // remember the prompt; refresh() hands it to the agent this call creates
      if (e.tool === 'Agent' && typeof e.prompt === 'string' && typeof e.description === 'string') {
        return { ...logged, pending: [...logged.pending, { description: e.description, text: e.prompt, t: now }].slice(-20) }
      }
      return logged
    })
    queueWrite($)
    const ran = await next(e)
    if (!e.agentId) await update($, view, v => ({ ...v, main: undefined }))
    if (e.tool === 'Agent') await refresh($)
    queueWrite($)
    return ran
  })

  // every message sent to an agent after its birth (the model's SendMessage, or ours)
  on('session.send', async ($, e, next) => {
    const sent = await next(e)
    if (sent.isDelivered && !fromHQ.has(e.text)) {
      const { agents } = await read($, view)
      const to = agents.find(a => a.id === e.to || a.name === e.to || `agentId:${a.id}` === e.to)
      if (to) {
        const t = await $.clock.now()
        await update($, feed, f => pushMsg(f, to.id, { t, from: e.agentId ? 'agente' : BOSS, text: e.text }))
        queueWrite($)
      }
    }
    return sent
  })

  // live "voice": what each agent is writing right now
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? ''
    voices.set(id, '')
    for await (const c of next(e)) {
      if (c.kind === 'text' || c.kind === 'thinking') {
        voices.set(id, ((voices.get(id) ?? '') + c.text).slice(-400))
        queueWrite($)
      }
      yield c
    }
  })

  // each agent's final answer and token bill; on the main loop, the reply owed to HQ or to a peer
  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? ''
    if (!id && awaiting) {
      const { seq, from } = awaiting
      awaiting = undefined
      const t = await $.clock.now()
      await $.fs.write(`${REPLIES}/${seq}.json`, JSON.stringify({ text: e.answer, at: t })).catch(() => undefined)
      await update($, feed, f => ({
        ...pushMsg(f, '', { t, from: BOSS, text: cut(e.answer, 4000), status: `a ${from}` }),
        peers: f.peers?.[from] ? { ...f.peers, [from]: { ...f.peers[from], isWaiting: false, lastSeen: t } } : f.peers,
      }))
    }
    const u = e.usage
    await update($, feed, f => ({
      ...f,
      answers: id ? { ...f.answers, [id]: cut(e.answer, 2000) } : f.answers,
      usage: u
        ? { ...f.usage, [id]: { input: (f.usage[id]?.input ?? 0) + u.input_tokens, output: (f.usage[id]?.output ?? 0) + u.output_tokens, cacheRead: (f.usage[id]?.cacheRead ?? 0) + u.cache_read_input_tokens, model: u.model } }
        : f.usage,
    }))
    queueWrite($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const v = await read($, view)
    const lines = treeLines(v)
    if (e.surface === 'desktop') {
      const { Box, Text, Link } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Link href={HQ_URL} label="Abrir Napoleon HQ" />
          {lines.map((l, i) => <Text bold={i === 0} dimColor={i > 0 && !l.includes('●')}>{l}</Text>)}
        </Box>
      )
    }
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {lines.map((l, i) => <Text bold={i === 0} dimColor={i > 0 && !l.includes('●')}>{l}</Text>)}
        <Text dimColor>{HQ_URL}</Text>
      </Box>
    )
  })
}
