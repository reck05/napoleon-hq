import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { localLaunch, openLocalApp, requestLocalTicket } from '../scripts/mobile-setup.mjs'

const KEY = 'b'.repeat(64)
const CODE = 'c'.repeat(64)
const getTicket = async () => ({ code: CODE, expiresIn: 60 })
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-local-launch-'))
  fs.writeFileSync(path.join(dir, 'access.key'), KEY)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('local credentials mint a short-lived ticket through an HTTP header without exposing the permanent key in argv', async t => {
  const dir = fixture(t)
  let sent
  const ticket = await requestLocalTicket({ dir, port: 8123, fetcher: async (url, options) => {
    sent = { url, options }
    return new Response(JSON.stringify({ code: CODE, expiresIn: 60 }))
  } })
  assert.equal(sent.url, 'http://127.0.0.1:8123/api/access/local-ticket')
  assert.equal(sent.url.includes(KEY), false)
  assert.equal(sent.options.headers.authorization, `Bearer ${KEY}`)
  assert.equal(sent.options.headers.origin, undefined)
  assert.equal(sent.options.method, 'POST')
  assert.equal(sent.options.redirect, 'error')
  assert.ok(sent.options.signal instanceof AbortSignal)
  const launch = localLaunch({ code: ticket.code, port: 8123, platform: 'darwin' })
  const url = new URL(launch.args[0])
  assert.equal(url.origin, 'http://localhost:8123')
  assert.equal(url.search, '')
  assert.equal(url.hash, `#access=${CODE}`)
  assert.equal(JSON.stringify(launch).includes(KEY), false)
  assert.equal(fs.readFileSync(path.join(dir, 'access.key'), 'utf8'), KEY)
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
    assert.equal(fs.statSync(path.join(dir, 'access.key')).mode & 0o777, 0o600)
  }
})

test('macOS, Windows and Linux launchers use direct executable arguments rather than shell commands', t => {
  for (const [platform, executable] of [['darwin', '/usr/bin/open'], ['win32', 'rundll32.exe'], ['linux', 'xdg-open']]) {
    const launch = localLaunch({ code: CODE, platform })
    assert.equal(launch.command, executable)
    assert.equal(launch.args.at(-1), `http://localhost:4517/#access=${CODE}`)
    assert.equal(JSON.stringify(launch).includes(KEY), false)
  }
  assert.throws(() => localLaunch({ code: CODE, platform: 'unknown' }), /sistema/)
})

test('invalid ports, missing keys and malformed secrets fail before opening a browser without leaking content', async t => {
  const dir = fixture(t)
  for (const port of [0, 80, 65536, 4517.1, '4517', NaN]) assert.throws(() => localLaunch({ code: CODE, port }), /Puerto local inválido/)
  let opened = false
  const invalid = 'malicious-secret;$(echo should-never-run)'
  fs.writeFileSync(path.join(dir, 'access.key'), invalid)
  await assert.rejects(openLocalApp({ dir, probe: async () => ({ ok: true }), launch: () => { opened = true } }), error => {
    assert.equal(error.message.includes(invalid), false)
    return /acceso temporal/.test(error.message)
  })
  assert.equal(opened, false)
  fs.rmSync(path.join(dir, 'access.key'))
  await assert.rejects(requestLocalTicket({ dir }), /todavía no ha creado/)
  assert.throws(() => localLaunch({ code: invalid }), /código temporal/)
})

test('authenticated local opening waits for readiness and suppresses opener output', async t => {
  const dir = fixture(t)
  const probes = []
  let calls = 0
  let opened
  await openLocalApp({
    dir, port: 5432, platform: 'linux', getTicket,
    probe: async (port, timeout) => { probes.push({ port, timeout }); return { ok: ++calls > 1 } },
    launch: (command, args, options) => {
      opened = { command, args, options }
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('exit', 0))
      return child
    },
  })
  assert.equal(probes.length, 2)
  assert.ok(probes.every(probe => probe.port === 5432 && probe.timeout > 0 && probe.timeout <= 500))
  assert.equal(opened.command, 'xdg-open')
  assert.equal(opened.args[0], `http://localhost:5432/#access=${CODE}`)
  assert.equal(JSON.stringify(opened).includes(KEY), false)
  assert.deepEqual(opened.options, { shell: false, stdio: 'ignore' })
})

test('opener failures containing sensitive arguments are reported without those arguments', async t => {
  const dir = fixture(t)
  await assert.rejects(openLocalApp({ dir, getTicket, probe: async () => ({ ok: true }), launch: () => { throw new Error(KEY) } }), error => !error.message.includes(KEY))
  await assert.rejects(openLocalApp({
    dir, getTicket, probe: async () => ({ ok: true }), launch: () => {
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('error', new Error(KEY)))
      return child
    },
  }), error => !error.message.includes(KEY))
})

test('invalid, reused permanent-key and rejected ticket responses never reach a browser or error output', async t => {
  const dir = fixture(t)
  const fetchers = [
    async () => { throw new Error(KEY) },
    async () => new Response(KEY, { status: 403 }),
    async () => new Response(JSON.stringify({ code: KEY, expiresIn: 60 })),
    async () => new Response(JSON.stringify({ code: CODE, expiresIn: 600 })),
    async () => new Response(JSON.stringify({ code: 'invalid-ticket', expiresIn: 60 })),
  ]
  for (const fetcher of fetchers) await assert.rejects(requestLocalTicket({ dir, fetcher }), error => !error.message.includes(KEY) && /acceso temporal/.test(error.message))
})
