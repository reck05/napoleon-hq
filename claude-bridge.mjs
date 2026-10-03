import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { protect, protectDirectory } from './secure.mjs'

const run = promisify(execFile)
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
const row = () => ({ calls: 0, log: [], voice: '', convo: [] })

// Only manages Claude sessions created from HQ.
export class ClaudeBridge {
  constructor({ dir, root, onChange, queryFn = query, authFn }) {
    this.dir = path.join(dir, 'claude')
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    protectDirectory(this.dir)
    const savedFile = path.join(this.dir, 'bridge.json')
    if (fs.existsSync(savedFile)) protect(savedFile)
    this.catalogFile = path.join(dir, 'projects.json')
    this.root = root
    this.onChange = onChange
    this.queryFn = queryFn
    this.binary = process.env.CLAUDE_BIN || (fs.existsSync(path.join(os.homedir(), '.local/bin/claude')) ? path.join(os.homedir(), '.local/bin/claude') : 'claude')
    this.authFn = authFn || (async () => {
      const { stdout } = await run(this.binary, ['auth', 'status'], { timeout: 10000 }).catch(e => ({ stdout: e.stdout || '{}' }))
      return JSON.parse(stdout).loggedIn === true
    })
    this.saved = read(path.join(this.dir, 'bridge.json'), { activeProjectId: null, sessions: {} })
    this.requests = new Map()
    this.connected = true
    this.authenticated = false
    this.error = ''
  }
  changed() { this.onChange?.() }
  save() {
    const file = path.join(this.dir, 'bridge.json')
    fs.writeFileSync(file, JSON.stringify(this.saved), { mode: 0o600 })
    protect(file)
  }
  projects() { return read(this.catalogFile, []).map(p => ({ ...p, available: p.kind === 'local' && !!p.path && fs.existsSync(p.path), active: p.id === this.saved.activeProjectId })) }
  active() { return this.saved.sessions[this.saved.activeProjectId] }
  connection() {
    return { engine: 'claude', managed: true, connected: this.connected, authenticated: this.authenticated, error: this.error,
      activeProjectId: this.saved.activeProjectId, projectName: this.active()?.project.name ?? null, busy: !!this.controller,
      requests: [...this.requests.values()].map(({ id, method, params }) => ({ id, method, params })) }
  }
  state() { const s = this.active(); return { v: 1, engine: 'claude', updatedAt: Date.now(), sessionStart: s?.startedAt ?? 0, napoleon: s?.row ?? row(), agents: [] } }
  async start() {
    try { this.authenticated = await this.authFn(); this.error = this.authenticated ? '' : 'Inicia sesión en Claude Code en esta computadora para conectar tu cuenta.' }
    catch { this.authenticated = false; this.error = 'No se pudo comprobar Claude Code. Revisa su instalación.' }
    this.changed()
  }
  async select(projectId) {
    if (this.controller) throw new Error('Detén la tarea de Claude antes de cambiar de proyecto.')
    const project = this.projects().find(p => p.id === projectId && p.available)
    if (!project) throw new Error('El proyecto no tiene una carpeta local disponible.')
    await this.start()
    if (!this.authenticated) throw new Error(this.error)
    this.saved.sessions[projectId] ??= { project, startedAt: Date.now(), row: row() }
    this.saved.activeProjectId = projectId
    this.save(); this.changed()
    return { ok: true, projectId }
  }
  permission(toolName, input, { signal }) {
    return new Promise(resolve => {
      const id = crypto.randomUUID()
      const finish = value => { signal.removeEventListener('abort', cancel); this.requests.delete(id); this.changed(); resolve(value) }
      const cancel = () => finish({ behavior: 'deny', message: 'La tarea fue interrumpida.' })
      const questions = toolName === 'AskUserQuestion' ? input.questions?.map(q => ({ ...q, id: q.question })) : undefined
      this.requests.set(id, { id, method: toolName, params: { reason: `Claude solicita ${toolName}`, command: input.command, permissions: input, questions }, input, toolName, finish })
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel(); else this.changed()
    })
  }
  answer(id, decision, answers) {
    const request = this.requests.get(id)
    if (!request) throw new Error('Esta solicitud ya no está pendiente.')
    if (!['accept', 'decline'].includes(decision)) throw new Error('Respuesta inválida.')
    const input = request.toolName === 'AskUserQuestion' ? { ...request.input, answers: answers ?? {} } : request.input
    request.finish(decision === 'accept' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'El usuario rechazó esta acción.' })
    return { ok: true }
  }
  receive(message, s) {
    const r = s.row
    if (message.type === 'system' && message.subtype === 'init') s.id = message.session_id
    if (message.type === 'stream_event' && message.event?.delta?.type === 'text_delta') r.voice += message.event.delta.text
    if (message.type === 'assistant') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'text') { r.convo.push({ t: Date.now(), from: 'Claude', text: block.text }); r.voice = '' }
        if (block.type === 'tool_use') { r.calls++; r.tool = block.name; r.log.push({ t: Date.now(), tool: block.name, detail: String(block.input?.command ?? block.input?.file_path ?? block.input?.description ?? '').slice(0, 200) }) }
      }
    }
    if (message.type === 'result') {
      r.voice = ''; r.tool = undefined
      if (message.is_error) r.convo.push({ t: Date.now(), from: 'sistema', text: message.errors?.join('\n') || message.result || 'Claude no pudo completar la tarea.' })
      if (message.usage) r.usage = { input: message.usage.input_tokens, output: message.usage.output_tokens, cacheRead: message.usage.cache_read_input_tokens, model: 'Claude Code' }
    }
    r.convo = r.convo.slice(-100); r.log = r.log.slice(-100)
    this.changed()
  }
  async send(to, text) {
    if (to !== 'napoleon') throw new Error('Envía la instrucción al coordinador Claude.')
    if (this.controller) throw new Error('Claude está trabajando. Detén la tarea o espera para dar la siguiente instrucción.')
    await this.start()
    if (!this.authenticated) throw new Error(this.error)
    if (this.controller) throw new Error('Claude está trabajando. Espera para enviar otra tarea.')
    const s = this.active()
    if (!s) throw new Error('Selecciona un proyecto antes de enviar una tarea.')
    const controller = new AbortController()
    this.controller = controller
    s.row.convo.push({ t: Date.now(), from: 'tú', text, status: 'entregado' })
    this.save(); this.changed()
    this.running = (async () => {
      try {
        const options = { cwd: s.project.path, pathToClaudeCodeExecutable: this.binary, abortController: controller,
          permissionMode: 'default', settingSources: ['user', 'project', 'local'], includePartialMessages: true,
          systemPrompt: { type: 'preset', preset: 'claude_code', append: fs.readFileSync(path.join(this.root, 'coordinator.md'), 'utf8') },
          canUseTool: (name, input, context) => this.permission(name, input, context), ...(s.id ? { resume: s.id } : {}) }
        for await (const message of this.queryFn({ prompt: text, options })) this.receive(message, s)
      } catch (error) {
        s.row.convo.push({ t: Date.now(), from: 'sistema', text: controller.signal.aborted ? 'Tarea interrumpida.' : error.message })
      } finally {
        controller.abort(); this.controller = null; s.row.voice = ''; s.row.tool = undefined; this.save(); this.changed()
      }
    })()
    return { ok: true }
  }
  async interrupt() { this.controller?.abort(); return { ok: true } }
  close() { this.controller?.abort() }
}
