// Napoleon HQ server: serves the built app, streams the orquestador mod's state.json over SSE,
// queues orders (typed in HQ, or sent by peers such as Codex) into outbox.jsonl for the mod to deliver,
// and hands peers Napoleon's replies, which the mod writes to replies/<id>.json.
// ponytail: stdlib only (http + fs.watch); no express/ws needed for one file and a handful of tabs.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 4517)
const DIR = process.env.NAPOLEON_DIR ?? path.join(os.homedir(), '.claude', 'napoleon')
const STATE = path.join(DIR, 'state.json')
const OUTBOX = path.join(DIR, 'outbox.jsonl')
const REPLIES = path.join(DIR, 'replies')
const PEER_KEY_FILE = path.join(DIR, 'peer.key')
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }

// Orders write into the person's Claude session, so only trusted callers may send them:
// - the HQ page: a per-run token baked into the served page, plus Host and Origin checks (blocks other sites and DNS rebinding)
// - peers (Codex, other accounts): local processes holding the key in peer.key, a file only this Windows user can read
const TOKEN = crypto.randomBytes(24).toString('hex')
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`])
const ORIGINS = new Set([...HOSTS].map(h => `http://${h}`))

fs.mkdirSync(REPLIES, { recursive: true })
if (!fs.existsSync(PEER_KEY_FILE)) fs.writeFileSync(PEER_KEY_FILE, crypto.randomBytes(24).toString('hex'), { mode: 0o600 })
const PEER_KEY = fs.readFileSync(PEER_KEY_FILE, 'utf8').trim()

const clients = new Set()
let last = ''
let seq = 0

const readState = () => {
  try { return fs.readFileSync(STATE, 'utf8') } catch { return '' }
}

const broadcast = () => {
  const text = readState()
  // a half-written file fails to parse; the next watch event brings the whole one
  if (!text || text === last) return
  try { JSON.parse(text) } catch { return }
  last = text
  for (const res of clients) res.write(`event: state\ndata: ${text}\n\n`)
}

let timer
fs.watch(DIR, () => {
  clearTimeout(timer)
  timer = setTimeout(broadcast, 30)
})
setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 15000)

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const clean = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

function readBody(req, fn) {
  let body = ''
  req.on('data', c => { body += c; if (body.length > 20_000) req.destroy() })
  req.on('end', () => { let msg = null; try { msg = JSON.parse(body) } catch { /* bad json */ } fn(msg) })
}

// strictly increasing, and past anything queued before the mod's session began
function queue(order) {
  seq = Math.max(seq + 1, Date.now() * 1000)
  fs.appendFileSync(OUTBOX, JSON.stringify({ seq, ...order, t: Date.now() }) + '\n')
  return seq
}

// an order typed in HQ
function send(req, res) {
  const origin = req.headers.origin
  if ((origin && !ORIGINS.has(origin)) || req.headers['x-hq-token'] !== TOKEN) return json(res, 403, { error: 'forbidden' })
  readBody(req, msg => {
    const to = clean(msg?.to, 200)
    const text = clean(msg?.text, 8000)
    if (!to || !text) return json(res, 400, { error: 'to and text are required' })
    json(res, 200, { ok: true, seq: queue({ to, text }) })
  })
}

// a peer (Codex, another account) talking to Napoleon
function peer(req, res, url) {
  if (req.headers['x-peer-key'] !== PEER_KEY) return json(res, 403, { error: 'clave de peer inválida' })

  if (url.pathname === '/api/peer/ask' && req.method === 'POST') {
    return readBody(req, msg => {
      const from = clean(msg?.from, 60) || 'peer'
      const text = clean(msg?.text, 8000)
      if (!text) return json(res, 400, { error: 'text is required' })
      json(res, 200, { id: String(queue({ to: 'napoleon', from, text })) })
    })
  }

  // long poll: answers as soon as replies/<id>.json exists, or after ~25 s with done:false
  if (url.pathname === '/api/peer/reply') {
    const id = (url.searchParams.get('id') ?? '').replace(/[^0-9]/g, '')
    const file = path.join(REPLIES, `${id}.json`)
    const until = Date.now() + 25_000
    let isGone = false
    req.on('close', () => { isGone = true })
    const poll = () => {
      if (isGone) return
      if (id && fs.existsSync(file)) {
        try { return json(res, 200, { done: true, ...JSON.parse(fs.readFileSync(file, 'utf8')) }) } catch { /* mid-write: next round */ }
      }
      if (Date.now() > until) return json(res, 200, { done: false })
      setTimeout(poll, 400)
    }
    return poll()
  }

  if (url.pathname === '/api/peer/status') {
    try {
      const st = JSON.parse(readState())
      return json(res, 200, { tool: st.napoleon?.tool, agents: st.agents.map(a => ({ status: a.status, area: a.area, description: a.description, tool: a.tool })) })
    } catch { return json(res, 200, {}) }
  }
  json(res, 404, { error: 'not found' })
}

http
  .createServer((req, res) => {
    if (!HOSTS.has(req.headers.host ?? '')) return json(res, 421, { error: 'wrong host' })
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/api/health') return json(res, 200, { ok: true })
    if (url.pathname === '/api/send' && req.method === 'POST') return send(req, res)
    if (url.pathname.startsWith('/api/peer/')) return peer(req, res, url)
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const text = readState()
      if (text) res.write(`event: state\ndata: ${text}\n\n`)
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    const file = path.join(DIST, path.normalize(url.pathname).replace(/^([/\\])+/, ''))
    const isFile = file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()
    const target = isFile ? file : path.join(DIST, 'index.html')
    if (!fs.existsSync(target)) { res.writeHead(503, { 'content-type': 'text/plain' }); return res.end('Napoleon HQ no está compilado: npm run build') }
    if (target.endsWith('index.html')) {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' })
      return res.end(fs.readFileSync(target, 'utf8').replace('</head>', `<meta name="hq-token" content="${TOKEN}"></head>`))
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' })
    fs.createReadStream(target).pipe(res)
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Napoleon HQ en http://localhost:${PORT} · ${DIR}`))
