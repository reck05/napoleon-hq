import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { cleanupLaunchFiles, createLocalLaunchFile, localLaunch, openLocalApp, requestLocalTicket } from '../scripts/mobile-setup.mjs'
import { isPrivate } from '../secure.mjs'

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
  const file = createLocalLaunchFile({ dir, code: ticket.code, port: 8123 })
  const launch = localLaunch({ file, platform: 'darwin' })
  const url = new URL(launch.args[0])
  assert.equal(url.protocol, 'file:')
  assert.equal(url.search, '')
  assert.equal(url.hash, '')
  assert.equal(fileURLToPath(url), file)
  assert.equal(JSON.stringify(launch).includes(KEY), false)
  assert.equal(JSON.stringify(launch).includes(CODE), false)
  assert.equal(isPrivate(file), true)
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`http-equiv="refresh" content="0;url=http://localhost:8123/#access=${CODE}"`))
  assert.equal(fs.readFileSync(file, 'utf8').includes(KEY), false)
  assert.equal(fs.readFileSync(path.join(dir, 'access.key'), 'utf8'), KEY)
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
    assert.equal(fs.statSync(path.join(dir, 'access.key')).mode & 0o777, 0o600)
  }
})

test('macOS, Windows and Linux launchers use direct executable arguments rather than shell commands', t => {
  const dir = fixture(t)
  const file = createLocalLaunchFile({ dir, code: CODE })
  for (const [platform, executable] of [['darwin', '/usr/bin/open'], ['win32', 'rundll32.exe'], ['linux', 'xdg-open']]) {
    const launch = localLaunch({ file, platform })
    assert.equal(launch.command, executable)
    assert.equal(fileURLToPath(launch.args.at(-1)), file)
    assert.equal(JSON.stringify(launch).includes(KEY), false)
    assert.equal(JSON.stringify(launch).includes(CODE), false)
  }
  assert.throws(() => localLaunch({ file, platform: 'unknown' }), /sistema/)
})

test('invalid ports, missing keys and malformed secrets fail before opening a browser without leaking content', async t => {
  const dir = fixture(t)
  for (const port of [0, 80, 65536, 4517.1, '4517', NaN]) assert.throws(() => createLocalLaunchFile({ dir, code: CODE, port }), /Puerto local inválido/)
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
  assert.throws(() => createLocalLaunchFile({ dir, code: invalid }), /código temporal/)
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
  const file = fileURLToPath(opened.args[0])
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`localhost:5432/#access=${CODE}`))
  assert.equal(isPrivate(file), true)
  assert.equal(JSON.stringify(opened).includes(KEY), false)
  assert.equal(JSON.stringify(opened).includes(CODE), false)
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
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.startsWith('launch-')), [])
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

test('expired launch files are cleaned on the next opening while current and unrelated files survive', t => {
  const dir = fixture(t)
  const old = createLocalLaunchFile({ dir, code: CODE })
  const older = new Date(Date.now() - 61000)
  fs.utimesSync(old, older, older)
  const unrelated = path.join(dir, 'launch-user-report.html')
  fs.writeFileSync(unrelated, 'keep me')
  fs.utimesSync(unrelated, older, older)
  const current = createLocalLaunchFile({ dir, code: CODE })
  assert.equal(fs.existsSync(old), false)
  assert.equal(fs.existsSync(current), true)
  assert.equal(fs.existsSync(unrelated), true)
  cleanupLaunchFiles({ dir, now: Date.now() + 61000 })
  assert.equal(fs.existsSync(current), false)
  assert.equal(fs.existsSync(unrelated), true)
})

test('launchers reject symlinks and public files rather than passing an unprotected credential file to the OS', t => {
  const dir = fixture(t)
  const file = createLocalLaunchFile({ dir, code: CODE })
  if (process.platform !== 'win32') {
    fs.chmodSync(file, 0o644)
    assert.throws(() => localLaunch({ file }), /archivo privado/)
    fs.chmodSync(file, 0o600)
    const symlink = path.join(dir, `launch-${crypto.randomUUID()}.html`)
    fs.symlinkSync(file, symlink)
    assert.throws(() => localLaunch({ file: symlink }), /archivo privado/)
  }
})
