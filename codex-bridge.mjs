import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
const emptyRow = () => ({ calls: 0, log: [], voice: '', convo: [] })
const textInput = text => [{ type: 'text', text, text_elements: [] }]
const toolTypes = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'collabAgentToolCall'])

// Owns only sessions created from HQ. Existing desktop chats are never resumed or changed.
export class CodexBridge {
  constructor({ dir, root, onChange }) {
    this.dir = dir
    this.root = root
    this.onChange = onChange
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') {
      fs.chmodSync(dir, 0o700)
      const savedFile = path.join(dir, 'bridge.json')
      if (fs.existsSync(savedFile)) fs.chmodSync(savedFile, 0o600)
    }
    this.saved = readJSON(path.join(dir, 'bridge.json'), { activeProjectId: null, sessions: {} })
    this.catalog = readJSON(path.join(dir, 'projects.json'), [])
    this.sessions = new Map()
    this.requests = new Map()
    this.pending = new Map()
    this.seen = new Set()
    this.nextId = 0
    this.connected = false
    this.authenticated = false
    this.error = ''
    this.starting = null
    this.selection = null
  }

  projects() {
    return this.catalog.map(p => ({ ...p, available: p.kind === 'local' && !!p.path && fs.existsSync(p.path), active: this.saved.activeProjectId === p.id }))
  }

  connection() {
    const s = this.active()
    return { engine: 'codex', connected: this.connected, authenticated: this.authenticated, error: this.error,
      activeProjectId: this.saved.activeProjectId, projectName: s?.project.name ?? null, busy: !!s?.turnId,
      requests: [...this.requests.values()].map(r => ({ id: r.id, method: r.method, params: r.params })) }
  }

  active() { return this.sessions.get(this.saved.sessions[this.saved.activeProjectId]) }

  state() {
    const s = this.active()
    return { v: 1, engine: 'codex', updatedAt: Date.now(), sessionStart: s?.startedAt ?? 0,
      napoleon: s?.row ?? emptyRow(), agents: s ? [...s.agents.values()] : [] }
  }

  changed() { this.onChange?.() }

  write(message) {
    if (!this.child?.stdin.writable) throw new Error('Codex no está conectado')
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  rpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex no respondió a ${method}`)) }, 60000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.write({ id, method, params }) } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e) }
    })
  }

  async start() {
    if (this.connected) return
    if (this.starting) return this.starting
    this.starting = this.connect().finally(() => { this.starting = null })
    return this.starting
  }

  async connect() {
    const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
    const binary = process.env.CODEX_BIN || (fs.existsSync(bundled) ? bundled : 'codex')
    this.child = spawn(binary, ['app-server', '--listen', 'stdio://'], { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.on('data', () => {}) // Protocol errors arrive over JSON-RPC. Never expose raw runtime logs.
    createInterface({ input: this.child.stdout }).on('line', line => {
      try { this.receive(JSON.parse(line)) } catch { /* non-protocol line */ }
    })
    const disconnected = message => {
      this.connected = false
      this.error = message
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)) }
      this.pending.clear()
      this.requests.clear()
      for (const s of this.sessions.values()) { s.turnId = null; s.row.tool = undefined }
      this.sessions.clear()
      this.changed()
    }
    this.child.on('error', e => disconnected(`No se pudo iniciar Codex: ${e.message}`))
    this.child.on('exit', () => disconnected('Codex se ha desconectado. Reinicia Napoleon HQ.'))
    try {
      await this.rpc('initialize', { clientInfo: { name: 'napoleon_hq', title: 'Napoleon HQ', version: '0.2.0' }, capabilities: { experimentalApi: true } })
      this.write({ method: 'initialized' })
      const auth = await this.rpc('account/read', { refreshToken: false })
      this.authenticated = !!auth.account
      this.connected = true
      this.error = this.authenticated ? '' : 'Inicia sesión con codex login en Terminal.'
      this.changed()
      if (this.saved.activeProjectId && this.authenticated) await this.select(this.saved.activeProjectId)
    } catch (e) { this.error = e.message; this.changed(); throw e }
  }

  receive(message) {
    if (message.id !== undefined && !message.method) {
      const p = this.pending.get(message.id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(message.id)
      if (message.error) p.reject(new Error(message.error.message))
      else p.resolve(message.result)
      return
    }
    if (message.id !== undefined) {
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput', 'item/permissions/requestApproval'].includes(message.method)) {
        this.requests.set(String(message.id), message)
        this.changed()
      } else {
        this.write({ id: message.id, error: { code: -32601, message: `Napoleon HQ no admite ${message.method}` } })
      }
      return
    }
    this.event(message.method, message.params ?? {})
  }

  findRow(threadId) {
    const own = this.sessions.get(threadId)
    if (own) return { session: own, row: own.row, root: true }
    for (const s of this.sessions.values()) {
      const row = s.agents.get(threadId)
      if (row) return { session: s, row, root: false }
    }
  }

  addAgent(session, id, parent, description) {
    if (session.agents.has(id)) return session.agents.get(id)
    const row = { ...emptyRow(), id, type: 'codex', area: 'Codex', areaKey: 'otros',
      description: (description || 'Subagente Codex').slice(0, 160), parentId: parent === session.id ? undefined : parent,
      status: 'running', startedAt: Date.now() }
    session.agents.set(id, row)
    return row
  }

  async refreshAgent(session, id, subscribe) {
    const row = session.agents.get(id)
    try {
      const response = await this.rpc(subscribe ? 'thread/resume' : 'thread/read', { threadId: id, ...(subscribe ? {} : { includeTurns: true }) })
      const thread = response.thread
      row.startedAt = thread.createdAt * 1000 || row.startedAt
      if (thread.agentNickname || thread.name) row.description = thread.agentNickname || thread.name
      for (const turn of thread.turns ?? []) {
        for (const item of turn.items ?? []) {
          if (item.type === 'userMessage') {
            const key = `${id}/prompt/${item.id}`
            if (!this.seen.has(key)) {
              this.seen.add(key)
              row.convo.push({ t: (turn.startedAt || thread.createdAt) * 1000, from: 'Napoleon', text: item.content.filter(c => c.type === 'text').map(c => c.text).join('\n') })
            }
            continue
          }
          this.event('item/started', { threadId: id, item, at: (turn.startedAt || thread.createdAt) * 1000 })
          this.event('item/completed', { threadId: id, item, at: (turn.completedAt || thread.updatedAt || thread.createdAt) * 1000 })
        }
        if (turn.status !== 'inProgress') {
          row.status = turn.status === 'completed' ? 'completed' : 'failed'
          row.endedAt = (turn.completedAt || thread.updatedAt || thread.createdAt) * 1000
        }
      }
      this.changed()
    } catch (e) {
      row.convo.push({ t: Date.now(), from: 'sistema', text: `No se pudo recuperar la actividad del subagente: ${e.message}` })
      this.changed()
    }
  }

  event(method, p) {
    if (method === 'thread/started' && p.thread?.parentThreadId) {
      const parent = this.findRow(p.thread.parentThreadId)
      if (parent) this.addAgent(parent.session, p.thread.id, p.thread.parentThreadId, p.thread.name || p.thread.preview)
    }
    const found = this.findRow(p.threadId)
    if (!found) return
    const { session, row, root } = found
    if (method === 'turn/started') {
      if (root) session.turnId = p.turn.id
      row.voice = ''; row.tool = undefined
      if (!root) { row.status = 'running'; row.endedAt = undefined }
    }
    if (method === 'item/agentMessage/delta') row.voice = (row.voice + p.delta).slice(-2000)
    if (method === 'item/started' || method === 'item/completed') {
      const item = p.item
      if (!item) return
      const key = `${p.threadId}/${method}/${item.id}`
      if (this.seen.has(key)) return
      this.seen.add(key)
      if (item.type === 'subAgentActivity') {
        const activityKey = `${p.threadId}/${item.id}/${item.kind}`
        if (!this.seen.has(activityKey)) {
          this.seen.add(activityKey)
          const a = this.addAgent(session, item.agentThreadId, p.threadId, item.agentPath?.split('/').pop())
          if (item.kind === 'completed' || item.kind === 'interrupted') {
            a.status = item.kind === 'completed' ? 'completed' : 'killed'
            a.endedAt = Date.now()
          }
          void this.refreshAgent(session, a.id, item.kind === 'started')
        }
      }
      if (method === 'item/started' && toolTypes.has(item.type)) {
        row.calls++
        row.tool = item.tool || item.type
        row.log = [...row.log, { t: p.at ?? Date.now(), tool: row.tool, detail: (item.command || item.prompt || item.query || item.changes?.map(c => c.path).join(', ') || '').slice(0, 200) }].slice(-80)
      }
      if (item.type === 'agentMessage' && method === 'item/completed' && item.text) {
        row.convo = [...row.convo, { t: p.at ?? Date.now(), from: root ? 'Napoleon · Codex' : 'agente', text: item.text }].slice(-100)
        if (!root) row.answer = item.text
      }
      if (item.type === 'collabAgentToolCall') {
        for (const id of item.receiverThreadIds ?? []) {
          const a = this.addAgent(session, id, p.threadId, item.prompt)
          const state = item.agentsStates?.[id]
          if (state) {
            a.status = ['completed', 'errored', 'shutdown'].includes(state.status) ? (state.status === 'completed' ? 'completed' : 'failed') : 'running'
            if (a.status !== 'running') a.endedAt = Date.now()
            if (state.message) a.answer = state.message
          }
        }
      }
      if (method === 'item/completed' && toolTypes.has(item.type)) row.tool = undefined
    }
    if (method === 'thread/tokenUsage/updated') {
      const u = p.tokenUsage.total
      row.usage = { input: u.inputTokens, output: u.outputTokens, cacheRead: u.cachedInputTokens, model: session.model || 'Codex' }
    }
    if (method === 'turn/completed') {
      if (root) session.turnId = null
      else { row.status = p.turn.status === 'completed' ? 'completed' : 'failed'; row.endedAt = Date.now() }
      row.tool = undefined
      row.voice = ''
      if (p.turn.error) row.convo.push({ t: Date.now(), from: 'sistema', text: p.turn.error.message || 'Codex no pudo completar la tarea.' })
    }
    this.changed()
  }

  async select(projectId) {
    if (this.selection) throw new Error('Espera a que termine de abrirse el proyecto actual')
    const project = this.projects().find(p => p.id === projectId)
    if (typeof projectId !== 'string' || !project?.available) throw new Error('Este proyecto no tiene una carpeta local disponible')
    if (!this.connected || !this.authenticated) throw new Error('Codex todavía no está conectado a tu cuenta')
    this.selection = projectId
    try {
      const instructions = fs.readFileSync(path.join(this.root, 'coordinator.md'), 'utf8')
      let id = this.saved.sessions[projectId]
      if (!this.sessions.has(id)) {
        const options = { cwd: project.path, sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user', developerInstructions: instructions }
        const response = id
          ? await this.rpc('thread/resume', { threadId: id, ...options })
          : await this.rpc('thread/start', options)
        const thread = response.thread
        id = thread.id
        const s = { id, project, model: response.model ?? thread.model, startedAt: thread.createdAt * 1000, row: emptyRow(), agents: new Map(), turnId: null }
        this.sessions.set(id, s)
        // Recover messages, tools and child relationships from Codex's durable history.
        for (const turn of thread.turns ?? []) {
          for (const item of turn.items ?? []) {
            if (item.type === 'userMessage') s.row.convo.push({ t: (turn.startedAt || thread.createdAt) * 1000, from: 'tú', text: item.content.filter(c => c.type === 'text').map(c => c.text).join('\n'), status: 'entregado' })
            else {
              this.event('item/started', { threadId: id, item, at: (turn.startedAt || thread.createdAt) * 1000 })
              this.event('item/completed', { threadId: id, item, at: (turn.completedAt || thread.updatedAt) * 1000 })
            }
          }
          if (turn.status === 'inProgress') s.turnId = turn.id
        }
        s.row.convo = s.row.convo.slice(-100)
      }
      this.saved.sessions[projectId] = id
      this.saved.activeProjectId = projectId
      const file = path.join(this.dir, 'bridge.json')
      fs.writeFileSync(file, JSON.stringify(this.saved, null, 2), { mode: 0o600 })
      if (process.platform !== 'win32') fs.chmodSync(file, 0o600)
      this.changed()
      return { ok: true, projectId, threadId: id }
    } finally { this.selection = null }
  }

  async send(to, text) {
    const s = this.active()
    if (!s) throw new Error('Selecciona un proyecto en «proyectos» antes de enviar una tarea')
    const id = to === 'napoleon' ? s.id : to
    const found = this.findRow(id)
    if (!found || found.session !== s) throw new Error('El agente no pertenece al proyecto seleccionado')
    if (s.sending) throw new Error('Espera a que se entregue la orden anterior')
    s.sending = true
    try {
      if (to !== 'napoleon') {
        // Loaded child threads accept direct input; unloaded ones are resumed first.
        await this.rpc('thread/resume', { threadId: id })
      }
      const turn = to === 'napoleon' ? s.turnId : null
      const result = await this.rpc(turn ? 'turn/steer' : 'turn/start', { threadId: id, input: textInput(text), ...(turn ? { expectedTurnId: turn } : {}) })
      if (!turn && to === 'napoleon') s.turnId = result.turn.id
      found.row.convo.push({ t: Date.now(), from: 'tú', text, status: 'entregado' })
      this.changed()
      return { ok: true }
    } finally { s.sending = false }
  }

  async interrupt() {
    const s = this.active()
    if (s?.turnId) await this.rpc('turn/interrupt', { threadId: s.id, turnId: s.turnId })
    return { ok: true }
  }

  answer(id, decision, answers) {
    const request = this.requests.get(String(id))
    if (!request) throw new Error('La solicitud ya no está pendiente')
    let result
    if (request.method === 'item/tool/requestUserInput') {
      const valid = {}
      for (const q of request.params.questions) {
        const value = answers?.[q.id]
        if (typeof value !== 'string' || !value.trim()) throw new Error('Responde todas las preguntas')
        valid[q.id] = { answers: [value.slice(0, 8000)] }
      }
      result = { answers: valid }
    } else if (request.method === 'item/permissions/requestApproval') {
      result = { permissions: decision === 'accept' ? request.params.permissions : {}, scope: 'turn' }
    } else result = { decision: decision === 'accept' ? 'accept' : 'decline' }
    this.write({ id: request.id, result })
    this.requests.delete(String(id))
    this.changed()
    return { ok: true }
  }

  close() { this.child?.kill() }
}
