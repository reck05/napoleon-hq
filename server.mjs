// Local HQ: Codex sessions by default; --engine=claude preserves the Claude mod and peer bridge.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { CodexBridge } from './codex-bridge.mjs'
import { DeviceManager } from './devices.mjs'
import { createAccess } from './access.mjs'

const PORT = Number(process.env.PORT ?? 4517)
const ENGINE = process.argv.includes('--engine=claude') ? 'claude' : (process.env.NAPOLEON_ENGINE ?? 'codex')
if (!['codex', 'claude'].includes(ENGINE)) throw new Error('NAPOLEON_ENGINE must be codex or claude')
const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIR = process.env.NAPOLEON_DIR ?? path.join(os.homedir(), ENGINE === 'claude' ? '.claude' : '.codex', 'napoleon')
const STATE = path.join(DIR, 'state.json')
const OUTBOX = path.join(DIR, 'outbox.jsonl')
const REPLIES = path.join(DIR, 'replies')
const DIST = path.join(ROOT, 'dist')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }
const TOKEN = crypto.randomBytes(24).toString('hex')
fs.mkdirSync(DIR, { recursive: true })
const access = createAccess({ dir: DIR, port: PORT })
const HOSTS = access.hosts
const ORIGINS = access.origins
const devices = new DeviceManager({ dir: DIR, engine: ENGINE, port: PORT })
let peerKey = ''
if (ENGINE === 'claude') {
  fs.mkdirSync(REPLIES, { recursive: true })
  const keyFile = path.join(DIR, 'peer.key')
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(24).toString('hex'), { mode: 0o600 })
  peerKey = fs.readFileSync(keyFile, 'utf8').trim()
  if (!peerKey) throw new Error('The Claude peer key must not be empty')
}

const clients = new Set()
const routedStreams = new Set()
const closeStreams = () => {
  for (const res of clients) res.end()
  clients.clear()
  for (const controller of routedStreams) controller.abort()
  routedStreams.clear()
}
let timer
let seq = 0
const bridge = ENGINE === 'codex' ? new CodexBridge({ dir: DIR, root: ROOT, onChange: () => broadcast() }) : null
const readState = () => {
  if (bridge) return JSON.stringify(bridge.state())
  try { return fs.readFileSync(STATE, 'utf8') } catch { return '' }
}
const connection = () => ({ ...(bridge ? bridge.connection() : { engine: 'claude', connected: !!readState(), authenticated: false, activeProjectId: null, projectName: null, busy: false, error: '', requests: [] }), deviceId: 'local', deviceLabel: devices.label })
const broadcast = () => {
  if (!timer) timer = setTimeout(() => {
    timer = undefined
    const state = readState()
    try { if (state) JSON.parse(state) } catch { return }
    for (const res of clients) res.write(`${state ? `event: state\ndata: ${state}\n\n` : ''}event: connection\ndata: ${JSON.stringify(connection())}\n\n`)
  }, 80)
}
const watcher = ENGINE === 'claude' ? fs.watch(DIR, broadcast) : null
const heartbeat = setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 15000)
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
const clean = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : ''
async function readBody(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (Buffer.byteLength(raw) > 20000) throw new Error('Mensaje demasiado largo')
  }
  const body = JSON.parse(raw)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad json')
  return body
}
function queue(order) {
  seq = Math.max(seq + 1, Date.now() * 1000)
  fs.appendFileSync(OUTBOX, JSON.stringify({ seq, ...order, t: Date.now() }) + '\n')
  return seq
}
async function send(req, res, route) {
  if (!devices.authenticated(req) && !browserAuthorized(req)) return json(res, 403, { error: 'forbidden' })
  const msg = await readBody(req)
  if (!devices.authenticated(req) && msg.deviceId && msg.deviceId !== devices.data.selectedId) return json(res, 409, { error: 'La computadora seleccionada cambió. Revisa el destino antes de enviar el objetivo.' })
  if (route !== '/api/send') {
    if (!bridge) return json(res, 409, { error: 'Esta acción requiere el modo Codex' })
    if (route === '/api/project/select') return json(res, 200, await bridge.select(msg.projectId))
    if (route === '/api/interrupt') return json(res, 200, await bridge.interrupt())
    if (route === '/api/respond') return json(res, 200, bridge.answer(msg.id, msg.decision, msg.answers))
  }
  const to = clean(msg.to, 200)
  const text = clean(msg.text, 8000)
  if (!to || !text) return json(res, 400, { error: 'to and text are required' })
  return json(res, 200, bridge ? await bridge.send(to, text) : { ok: true, seq: queue({ to, text }) })
}
function browserAuthorized(req) {
  return ORIGINS.has(req.headers.origin ?? '') && req.headers['x-hq-token'] === TOKEN
}
async function deviceAction(req, res, route) {
  if (!browserAuthorized(req)) return json(res, 403, { error: 'forbidden' })
  const body = await readBody(req)
  if (route === '/api/devices/pairing') return json(res, 200, { token: devices.key, label: devices.label })
  if (route === '/api/devices/pair') return json(res, 200, await devices.pair(body))
  const result = route === '/api/devices/select' ? devices.select(body.id) : devices.remove(body.id)
  closeStreams()
  return json(res, 200, result)
}
async function proxyDevice(req, res, url, device) {
  if (req.method === 'POST' && !browserAuthorized(req)) return json(res, 403, { error: 'forbidden' })
  const events = url.pathname === '/api/events'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), events ? 8000 : 60000)
  res.on('close', () => controller.abort())
  if (events) routedStreams.add(controller)
  try {
    const message = req.method === 'POST' ? await readBody(req) : undefined
    if (message && (devices.data.selectedId !== device.id || (message.deviceId && message.deviceId !== device.id))) return json(res, 409, { error: 'La computadora seleccionada cambió. Revisa el destino antes de enviar el objetivo.' })
    const body = message ? JSON.stringify(message) : undefined
    const response = await devices.request(device, url.pathname + url.search, { method: req.method, body, signal: controller.signal })
    if (events && response.ok) {
      clearTimeout(timer)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const decoder = new TextDecoder()
      let pending = ''
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true })
        let end
        while ((end = pending.indexOf('\n\n')) !== -1) {
          let event = pending.slice(0, end)
          pending = pending.slice(end + 2)
          if (event.startsWith('event: connection\n')) {
            const data = JSON.parse(event.slice('event: connection\ndata: '.length))
            event = `event: connection\ndata: ${JSON.stringify({ ...data, deviceId: device.id, deviceLabel: device.label })}`
          }
          if (!res.write(event + '\n\n')) await new Promise(resolve => {
            const done = () => { res.off('drain', done); res.off('close', done); resolve() }
            res.once('drain', done); res.once('close', done)
          })
        }
      }
      return res.end()
    }
    const result = await response.json()
    if (url.pathname === '/api/connection' && response.ok) return json(res, response.status, { ...result, deviceId: device.id, deviceLabel: device.label })
    return json(res, response.status, result)
  } catch {
    if (res.destroyed || res.writableEnded) return
    if (res.headersSent) return res.end()
    return json(res, 503, { error: `${device.label} está sin conexión. Enciende el equipo o activa el despertar automático; no se enviará el objetivo a otra computadora.`, deviceId: device.id, offline: true })
  } finally {
    clearTimeout(timer)
    routedStreams.delete(controller)
  }
}
async function peer(req, res, url) {
  if (ENGINE !== 'claude') return json(res, 409, { error: 'El puente ask_claude requiere Napoleon HQ en modo Claude (--engine=claude).' })
  if (req.headers.origin && !ORIGINS.has(req.headers.origin)) return json(res, 403, { error: 'forbidden' })
  if (req.headers['x-peer-key'] !== peerKey) return json(res, 403, { error: 'clave de peer inválida' })
  if (url.pathname === '/api/peer/ask' && req.method === 'POST') {
    const msg = await readBody(req)
    const from = clean(msg.from, 60) || 'peer'
    const text = clean(msg.text, 8000)
    if (!text) return json(res, 400, { error: 'text is required' })
    return json(res, 200, { id: String(queue({ to: 'napoleon', from, text })) })
  }
  if (url.pathname === '/api/peer/reply' && req.method === 'GET') {
    const id = url.searchParams.get('id') ?? ''
    if (!/^\d{1,20}$/.test(id)) return json(res, 400, { error: 'invalid reply id' })
    const file = path.join(REPLIES, `${id}.json`)
    const until = Date.now() + 25000
    let pollTimer
    const poll = () => {
      if (res.destroyed || res.writableEnded) return
      try {
        const reply = JSON.parse(fs.readFileSync(file, 'utf8'))
        return json(res, 200, { done: true, text: reply.text, at: reply.at })
      } catch { /* no reply yet, or the mod is in the middle of writing it */ }
      if (Date.now() >= until) return json(res, 200, { done: false })
      pollTimer = setTimeout(poll, 400)
    }
    res.on('close', () => clearTimeout(pollTimer))
    poll()
    return
  }
  if (url.pathname === '/api/peer/status' && req.method === 'GET') {
    try {
      const st = JSON.parse(readState())
      return json(res, 200, { tool: st.napoleon?.tool, agents: st.agents.map(a => ({ status: a.status, area: a.area, description: a.description, tool: a.tool })) })
    } catch { return json(res, 200, {}) }
  }
  return json(res, 404, { error: 'not found' })
}

const server = http.createServer(async (req, res) => {
  try {
    if (!HOSTS.has(req.headers.host ?? '')) return json(res, 421, { error: 'wrong host' })
    const url = new URL(req.url ?? '/', 'http://x')
    const deviceAuthenticated = devices.authenticated(req)
    if (req.headers['x-device-key'] && !deviceAuthenticated) return json(res, 403, { error: 'clave de computadora inválida' })
    if (!deviceAuthenticated && !access.authorize(req, res, url)) return
    if (url.pathname === '/api/session' && req.method === 'GET') return json(res, 200, { token: TOKEN })
    if (url.pathname === '/api/device/info' && req.method === 'GET') return deviceAuthenticated ? json(res, 200, devices.info()) : json(res, 403, { error: 'clave de computadora requerida' })
    if (url.pathname === '/api/devices' && req.method === 'GET') return json(res, 200, await devices.list())
    if (['/api/devices/pair', '/api/devices/select', '/api/devices/remove', '/api/devices/pairing'].includes(url.pathname) && req.method === 'POST') return await deviceAction(req, res, url.pathname)
    if (url.pathname === '/api/mobile' && req.method === 'GET') return json(res, 200, access.info())
    if (url.pathname === '/api/mobile/link' && req.method === 'POST') {
      if (!browserAuthorized(req)) return json(res, 403, { error: 'forbidden' })
      return json(res, 200, access.pairingLink())
    }
    const selected = !deviceAuthenticated && devices.selected()
    const routedGet = ['/api/projects', '/api/connection', '/api/events'].includes(url.pathname) && req.method === 'GET'
    const routedPost = ['/api/send', '/api/project/select', '/api/interrupt', '/api/respond'].includes(url.pathname) && req.method === 'POST'
    if (selected && (routedGet || routedPost)) return await proxyDevice(req, res, url, selected)
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, engine: ENGINE })
    if (url.pathname === '/api/projects') return json(res, 200, { projects: bridge?.projects() ?? [] })
    if (url.pathname === '/api/connection') return json(res, 200, connection())
    if (url.pathname.startsWith('/api/peer/')) return await peer(req, res, url)
    if (['/api/send', '/api/project/select', '/api/interrupt', '/api/respond'].includes(url.pathname) && req.method === 'POST') return await send(req, res, url.pathname)
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const state = readState()
      if (state) res.write(`event: state\ndata: ${state}\n\n`)
      res.write(`event: connection\ndata: ${JSON.stringify(connection())}\n\n`)
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' })
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
    const file = path.resolve(DIST, '.' + url.pathname)
    const isFile = file.startsWith(DIST + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()
    const target = isFile ? file : path.join(DIST, 'index.html')
    if (!fs.existsSync(target)) { res.writeHead(503, { 'content-type': 'text/plain' }); return res.end('Napoleon HQ no está compilado: npm run build') }
    if (target.endsWith('index.html')) {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' })
      return res.end(fs.readFileSync(target, 'utf8').replace('</head>', `<meta name="hq-token" content="${TOKEN}"></head>`))
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' })
    fs.createReadStream(target).pipe(res)
  } catch (e) { if (!res.headersSent) json(res, 400, { error: e.message }); else res.end() }
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Napoleon HQ · ${ENGINE} · http://localhost:${PORT}`)
  void bridge?.start().catch(e => console.error(`Conexión pendiente: ${e.message}`))
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  bridge?.close(); watcher?.close(); clearInterval(heartbeat); clearTimeout(timer)
  closeStreams()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
})
