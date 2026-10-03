// Napoleon HQ server: serves the built app, streams the orquestador mod's state.json over SSE,
// and queues orders typed in HQ into outbox.jsonl, which the mod delivers into the session.
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
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }

// Orders write into the person's Claude session, so only this app may send them:
// a per-run token baked into the served page, plus Host and Origin checks (blocks other sites and DNS rebinding).
const TOKEN = crypto.randomBytes(24).toString('hex')
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`])
const ORIGINS = new Set([...HOSTS].map(h => `http://${h}`))

fs.mkdirSync(DIR, { recursive: true })
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

function send(req, res) {
  const origin = req.headers.origin
  if ((origin && !ORIGINS.has(origin)) || req.headers['x-hq-token'] !== TOKEN) return json(res, 403, { error: 'forbidden' })
  let body = ''
  req.on('data', c => { body += c; if (body.length > 20_000) req.destroy() })
  req.on('end', () => {
    let msg
    try { msg = JSON.parse(body) } catch { return json(res, 400, { error: 'bad json' }) }
    const to = typeof msg.to === 'string' ? msg.to.slice(0, 200) : ''
    const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 8000) : ''
    if (!to || !text) return json(res, 400, { error: 'to and text are required' })
    // strictly increasing, and past anything queued before the mod's session began
    seq = Math.max(seq + 1, Date.now() * 1000)
    fs.appendFileSync(OUTBOX, JSON.stringify({ seq, to, text, t: Date.now() }) + '\n')
    json(res, 200, { ok: true, seq })
  })
}

http
  .createServer((req, res) => {
    if (!HOSTS.has(req.headers.host ?? '')) return json(res, 421, { error: 'wrong host' })
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/api/health') return json(res, 200, { ok: true })
    if (url.pathname === '/api/send' && req.method === 'POST') return send(req, res)
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
