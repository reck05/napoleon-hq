import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { protect } from './secure.mjs'

const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const respond = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
const localAddress = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value)

export function createAccess({ dir, port, publicUrl: configured }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(dir, 0o700)
  const file = path.join(dir, 'access.key')
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
  protect(file)
  const key = fs.readFileSync(file, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('La clave de acceso móvil no es válida')
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(path.join(dir, 'mobile.json'), 'utf8')) } catch { /* not configured yet */ }
  const input = configured ?? process.env.NAPOLEON_PUBLIC_URL ?? saved.publicUrl
  let publicUrl = null
  if (input) {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('La dirección móvil debe ser un origen HTTPS, sin rutas ni credenciales')
    publicUrl = url.origin
  }
  const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`])
  const hosts = new Set([...localHosts, ...(publicUrl ? [new URL(publicUrl).host] : [])])
  const origins = new Set([...localHosts].map(host => `http://${host}`))
  if (publicUrl) origins.add(publicUrl)
  const localTickets = new Map()
  function loginPage(res) {
    const nonce = crypto.randomBytes(16).toString('base64')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` })
    res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar con Napoleon</title><style>body{font:17px system-ui;background:#101219;color:#eee;max-width:420px;margin:12vh auto;padding:24px}input,button{font:inherit;box-sizing:border-box;padding:14px;width:100%;margin:8px 0;border-radius:10px}button{background:#a8c0ff;border:0;cursor:pointer}p{line-height:1.5}#error{color:#ffb3b3}</style></head><body><h1>Napoleon HQ</h1><p>Abre el enlace que creaste en tu computadora o pega el código de acceso.</p><form><label for="code">Código de acceso</label><input id="code" type="password" autocomplete="off" required><button>Conectar</button></form><p id="error" role="alert"></p><script nonce="${nonce}">const input=document.querySelector('input'),error=document.querySelector('#error');async function login(){try{const r=await fetch('/api/access/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:input.value})});if(!r.ok)throw Error('El código no es correcto. Crea otro enlace en tu computadora.');location.replace('/')}catch(e){error.textContent=e.message}}document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();login()});const code=new URLSearchParams(location.hash.slice(1)).get('access');if(code){history.replaceState(null,'','/');input.value=code;login()}</script></body></html>`)
  }
  function info() {
    let status = { phase: publicUrl ? 'ready' : 'login', message: publicUrl ? 'Acceso privado preparado.' : 'Entra en Tailscale para conectar tu teléfono.' }
    try {
      const savedStatus = JSON.parse(fs.readFileSync(path.join(dir, 'mobile-status.json'), 'utf8'))
      if (['login', 'https', 'ready', 'error'].includes(savedStatus.phase) && typeof savedStatus.message === 'string') {
        status = { phase: savedStatus.phase, message: savedStatus.message.slice(0, 300) }
        if (typeof savedStatus.actionUrl === 'string') {
          const action = new URL(savedStatus.actionUrl)
          if (action.protocol === 'https:' && action.hostname === 'login.tailscale.com' && !action.username && !action.password) status.actionUrl = action.href
        }
      }
    } catch { /* Setup can still be pending on a manually started server. */ }
    return { url: publicUrl, configured: !!publicUrl, accessFile: file, status }
  }
  return {
    hosts, origins, publicUrl,
    info,
    pairingLink: () => {
      if (!publicUrl) throw new Error('Conecta primero Tailscale y ejecuta la configuración del teléfono en esta computadora.')
      return { url: `${publicUrl}/#access=${key}`, code: key }
    },
    authorize(req, res, url) {
      res.setHeader('referrer-policy', 'no-referrer')
      res.setHeader('x-content-type-options', 'nosniff')
      res.setHeader('x-frame-options', 'DENY')
      const proxied = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'tailscale-user-login'].some(name => req.headers[name] !== undefined)
      const local = !proxied && localAddress(req.socket.remoteAddress) && localHosts.has(req.headers.host)
      const bearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
      if (url.pathname === '/api/access/local-ticket' && req.method === 'POST') {
        if (!local || req.headers.origin !== undefined || !equal(bearer, key)) { respond(res, 403, { error: 'Acceso rechazado' }); return false }
        for (const [code, expires] of localTickets) if (expires <= Date.now()) localTickets.delete(code)
        while (localTickets.size >= 16) localTickets.delete(localTickets.keys().next().value)
        const code = crypto.randomBytes(32).toString('hex')
        localTickets.set(code, Date.now() + 60000)
        respond(res, 200, { code, expiresIn: 60 })
        return false
      }
      if (url.pathname === '/api/access/login' && req.method === 'POST') {
        if (!origins.has(req.headers.origin ?? '')) { respond(res, 403, { error: 'Acceso rechazado' }); return false }
        void (async () => {
          try {
            let raw = ''
            for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 2048) throw new Error('Código demasiado largo') }
            const body = JSON.parse(raw)
            const ticket = typeof body?.code === 'string' && local && (localTickets.get(body.code) ?? 0) > Date.now()
            if (!equal(body?.code, key) && !ticket) return respond(res, 403, { error: 'Código incorrecto' })
            if (ticket) localTickets.delete(body.code)
            res.setHeader('set-cookie', `hq_access=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${!local ? '; Secure' : ''}`)
            respond(res, 200, { ok: true })
          } catch { respond(res, 400, { error: 'Código inválido' }) }
        })()
        return false
      }
      const cookie = String(req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith('hq_access='))?.slice(10)
      // A loopback socket does not identify its user. Only the readiness probe
      // is public locally; sessions, state and commands always require a key.
      if (local && url.pathname === '/api/health' && req.method === 'GET') return true
      if (equal(cookie, key) || equal(bearer, key)) return true
      if (url.pathname.startsWith('/api/')) respond(res, 401, { error: 'Abre el enlace privado de tu computadora para conectarte.' })
      else loginPage(res)
      return false
    },
  }
}
