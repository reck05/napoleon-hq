import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createAccess } from '../access.mjs'
import { isPrivate } from '../secure.mjs'

test('private mobile access protects pages, state and orders behind HTTPS proxy', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-access-'))
  const publicUrl = 'https://my-mac.example.ts.net'
  const access = createAccess({ dir, port: 4517, publicUrl })
  const server = http.createServer((req, res) => {
    if (!access.hosts.has(req.headers.host)) { res.writeHead(421); return res.end() }
    if (!access.authorize(req, res, new URL(req.url, 'http://x'))) return
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"private":true}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }) })
  const request = (route, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method, headers: { host: 'my-mac.example.ts.net', ...headers } }, res => {
      let data = ''; res.on('data', c => { data += c }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    }); req.on('error', reject); req.end(body)
  })
  const link = access.pairingLink()
  assert.equal(new URL(link.url).hash, '#access=' + link.code)
  assert.equal(new URL(link.url).search, '')
  assert.ok(isPrivate(path.join(dir, 'access.key')), 'access.key must be owner-only (0600, or a single non-inherited ACE on Windows)')
  if (process.platform !== 'win32') assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
  assert.equal(createAccess({ dir, port: 4517, publicUrl }).pairingLink().code, link.code)
  await t.test('remote assets and API never reveal private state or access key before login', async () => {
    const page = await request('/')
    assert.equal(page.status, 200)
    assert.match(page.body, /Código de acceso/)
    assert.ok(!page.body.includes(link.code))
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/)
    for (const route of ['/api/events', '/api/projects', '/api/connection', '/api/send']) assert.equal((await request(route)).status, 401)
    assert.equal((await request('/api/projects', { headers: { host: 'localhost:4517', 'x-forwarded-for': '100.64.0.2' } })).status, 401)
    assert.equal((await request('/', { headers: { host: 'attacker.example' } })).status, 421)
  })
  await t.test('only a valid code and approved origin create a secure private session', async () => {
    const login = (origin, code) => request('/api/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
    assert.equal((await login('https://attacker.example', link.code)).status, 403)
    assert.equal((await login(publicUrl, 'wrong')).status, 403)
    assert.equal((await login(publicUrl, 'é'.repeat(64))).status, 403)
    const accepted = await login(publicUrl, link.code)
    assert.equal(accepted.status, 200)
    const cookie = accepted.headers['set-cookie'][0]
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/)
    assert.equal((await request('/api/events', { headers: { cookie: cookie.split(';')[0] } })).body, '{"private":true}')
    assert.equal((await request('/api/projects', { headers: { authorization: 'Bearer ' + link.code } })).status, 200)
  })
  await t.test('loopback clients require credentials even with a forged browser origin', async () => {
    const headers = { host: 'localhost:4517', origin: 'http://localhost:4517' }
    assert.match((await request('/', { headers })).body, /Código de acceso/)
    for (const route of ['/api/session', '/api/projects', '/api/connection', '/api/events', '/api/devices/pairing']) {
      assert.equal((await request(route, { headers })).status, 401)
    }
    assert.equal((await request('/api/send', { method: 'POST', headers, body: '{}' })).status, 401)
    assert.equal((await request('/api/health', { headers })).status, 200)
    assert.equal((await request('/api/health', { headers: { ...headers, 'x-forwarded-for': '100.64.0.2' } })).status, 401)
    assert.equal((await request('/api/health', { method: 'POST', headers })).status, 401)
    assert.equal((await request('/api/session', { headers: { ...headers, authorization: 'Bearer ' + link.code } })).status, 200)
    const accepted = await request('/api/access/login', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ code: link.code }) })
    assert.equal(accepted.status, 200)
    const cookie = accepted.headers['set-cookie'][0]
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.ok(!cookie.includes('Secure'))
    assert.equal((await request('/api/session', { headers: { ...headers, cookie: cookie.split(';')[0] } })).status, 200)
  })
  await t.test('unconfigured HTTPS never creates a fake mobile link', async () => {
    const other = fs.mkdtempSync(path.join(dir, 'other-'))
    assert.throws(() => createAccess({ dir: other, port: 4517, publicUrl: 'http://unsafe.example' }))
    assert.throws(() => createAccess({ dir: other, port: 4517 }).pairingLink(), /Tailscale/)
  })
  await t.test('local launch tickets require the owner key and redeem only once on loopback', async () => {
    const local = { host: 'localhost:4517' }
    const owner = { ...local, authorization: 'Bearer ' + link.code }
    const issue = headers => request('/api/access/local-ticket', { method: 'POST', headers })
    assert.equal((await issue(local)).status, 403)
    assert.equal((await issue({ ...owner, origin: 'http://localhost:4517' })).status, 403)
    assert.equal((await issue({ ...owner, 'x-forwarded-for': '100.64.0.2' })).status, 403)
    assert.equal((await issue({ authorization: owner.authorization })).status, 403)
    const issued = await issue(owner)
    assert.equal(issued.status, 200)
    assert.equal(issued.headers['cache-control'], 'no-store')
    const { code, expiresIn } = JSON.parse(issued.body)
    assert.match(code, /^[a-f0-9]{64}$/)
    assert.notEqual(code, link.code)
    assert.equal(expiresIn, 60)
    const redeem = (headers, value = code) => request('/api/access/login', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ code: value }) })
    assert.equal((await redeem({ origin: publicUrl })).status, 403)
    const accepted = await redeem({ ...local, origin: 'http://localhost:4517' })
    assert.equal(accepted.status, 200)
    assert.match(accepted.headers['set-cookie'][0], /HttpOnly/)
    assert.equal((await redeem({ ...local, origin: 'http://localhost:4517' })).status, 403)
    assert.equal((await request('/api/session', { headers: { ...local, authorization: 'Bearer ' + code } })).status, 401)
    const expiredCode = JSON.parse((await issue(owner)).body).code
    const now = Date.now()
    const clock = t.mock.method(Date, 'now', () => now + 61000)
    try { assert.equal((await redeem({ ...local, origin: 'http://localhost:4517' }, expiredCode)).status, 403) }
    finally { clock.mock.restore() }
  })
})
