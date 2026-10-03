import fs from 'node:fs'
import path from 'node:path'
import { CodexBridge } from './codex-bridge.mjs'
import { ClaudeBridge } from './claude-bridge.mjs'

export class AssistantBridge {
  constructor(options) {
    this.file = path.join(options.dir, 'assistant.json')
    this.bridges = { codex: new CodexBridge(options), claude: new ClaudeBridge(options) }
    this.engine = 'codex'
    try { const saved = JSON.parse(fs.readFileSync(this.file)); if (['codex', 'claude'].includes(saved.engine)) this.engine = saved.engine } catch { /* default */ }
    this.changed = options.onChange
  }
  get active() { return this.bridges[this.engine] }
  projects() { return this.active.projects() }
  state() { return this.active.state() }
  connection() { return { ...this.active.connection(), managed: true, engines: ['codex', 'claude'] } }
  async start() { return this.active.start() }
  async selectEngine(engine) {
    if (!['codex', 'claude'].includes(engine)) throw new Error('Asistente no válido.')
    if (this.switching) throw new Error('Espera a que termine de conectar el asistente.')
    if (this.active.connection().busy) throw new Error('Detén la tarea actual antes de cambiar de asistente.')
    const projectId = this.active.connection().activeProjectId
    this.switching = true
    try {
    this.engine = engine
    fs.writeFileSync(this.file, JSON.stringify({ engine }), { mode: 0o600 })
    await this.active.start()
    if (projectId && this.active.connection().authenticated && !this.active.connection().activeProjectId) await this.active.select(projectId)
    this.changed?.()
    return { ok: true, engine }
    } finally { this.switching = false }
  }
  select(id) { if (this.switching) throw new Error('Espera a que termine de conectar el asistente.'); return this.active.select(id) }
  send(to, text) { if (this.switching) throw new Error('Espera a que termine de conectar el asistente.'); return this.active.send(to, text) }
  answer(...args) { return this.active.answer(...args) }
  interrupt() { return this.active.interrupt() }
  close() { for (const bridge of Object.values(this.bridges)) bridge.close() }
}
