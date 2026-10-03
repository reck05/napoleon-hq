// Local Napoleon HQ server. Codex owns durable sessions; HQ renders their events over SSE.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { CodexBridge } from './codex-bridge.mjs'

const PORT = Number(process.env.PORT ?? 4517)
const DIR = process.env.NAPOLEON_DIR ?? path.join(os.homedir(), '.codex', 'napoleon')
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }

// Orders write into the person's Claude session, so only this app may send them:
// a per-run token baked into the served page, plus Host and Origin checks (blocks other sites and DNS rebinding).
const TOKEN = crypto.randomBytes(24).toString('hex')
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`])
const ORIGINS = new Set([...HOSTS].map(h => `http://${h}`))

fs.mkdirSync(DIR, { recursive: true })
const clients = new Set()
const bridge = new CodexBridge({ dir: DIR, root: path.dirname(fileURLToPath(import.meta.url)), onChange: () => broadcast() })

const readState = () => {
  return JSON.stringify(bridge.state())
}

const broadcast = () => {
  if (!timer) timer = setTimeout(() => { timer = undefined; flush() }, 80)
}

const flush = () => {
  const text = readState()
  for (const res of clients) res.write(`event: state\ndata: ${text}\n\nevent: connection\ndata: ${JSON.stringify(bridge.connection())}\n\n`)
}

let timer
setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 15000)

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }

function send(req, res, route) {
  const origin = req.headers.origin
  if (!ORIGINS.has(origin ?? '') || req.headers['x-hq-token'] !== TOKEN) return json(res, 403, { error: 'forbidden' })
  let body = ''
  req.on('data', c => { body += c; if (body.length > 20_000) req.destroy() })
  req.on('end', async () => {
    let msg
    try { msg = JSON.parse(body) } catch { return json(res, 400, { error: 'bad json' }) }
    try {
      if (route === '/api/project/select') return json(res, 200, await bridge.select(msg.projectId))
      if (route === '/api/interrupt') return json(res, 200, await bridge.interrupt())
      if (route === '/api/respond') return json(res, 200, bridge.answer(msg.id, msg.decision, msg.answers))
    const to = typeof msg.to === 'string' ? msg.to.slice(0, 200) : ''
    const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 8000) : ''
    if (!to || !text) return json(res, 400, { error: 'to and text are required' })
    json(res, 200, await bridge.send(to, text))
    } catch (e) { json(res, 400, { error: e.message }) }
  })
}

http
  .createServer((req, res) => {
    if (!HOSTS.has(req.headers.host ?? '')) return json(res, 421, { error: 'wrong host' })
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, engine: 'codex' })
    if (url.pathname === '/api/projects') return json(res, 200, { projects: bridge.projects() })
    if (url.pathname === '/api/connection') return json(res, 200, bridge.connection())
    if (['/api/send', '/api/project/select', '/api/interrupt', '/api/respond'].includes(url.pathname) && req.method === 'POST') return send(req, res, url.pathname)
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const text = readState()
      if (text) res.write(`event: state\ndata: ${text}\n\n`)
      res.write(`event: connection\ndata: ${JSON.stringify(bridge.connection())}\n\n`)
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' })
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
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`Napoleon HQ · Codex · http://localhost:${PORT}`)
    void bridge.start().catch(e => console.error(`Conexión pendiente: ${e.message}`))
  })

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { bridge.close(); clearTimeout(timer); process.exit(0) })
