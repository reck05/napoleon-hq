import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createAccess } from '../access.mjs'

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
  assert.equal(fs.statSync(path.join(dir, 'access.key')).mode & 0o777, 0o600)
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
  await t.test('local use remains available and unconfigured HTTPS never creates a fake mobile link', async () => {
    assert.equal((await request('/', { headers: { host: 'localhost:4517' } })).body, '{"private":true}')
    const other = fs.mkdtempSync(path.join(dir, 'other-'))
    assert.throws(() => createAccess({ dir: other, port: 4517, publicUrl: 'http://unsafe.example' }))
    assert.throws(() => createAccess({ dir: other, port: 4517 }).pairingLink(), /Tailscale/)
  })
})
