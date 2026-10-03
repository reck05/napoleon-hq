import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DeviceManager, deviceUrl } from '../devices.mjs'
import { isPrivate } from '../secure.mjs'

test('device addresses require private HTTPS or loopback HTTP without credentials', () => {
  assert.equal(deviceUrl('https://workstation.example.ts.net/'), 'https://workstation.example.ts.net')
  assert.equal(deviceUrl('http://127.0.0.1:4517'), 'http://127.0.0.1:4517')
  for (const url of ['http://192.168.1.3:4517', 'file:///tmp/key', 'https://user:pass@example.com/', 'https://example.com/subpath', 'https://example.com/?token=secret']) assert.throws(() => deviceUrl(url))
})

test('device secrets and identity persist with private permissions', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-devices-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const first = new DeviceManager({ dir, port: 4517, engine: 'codex' })
  const second = new DeviceManager({ dir, port: 4517, engine: 'codex' })
  assert.equal(first.key, second.key)
  assert.equal(first.info().id, second.info().id)
  assert.ok(isPrivate(first.keyFile), 'device.key must be owner-only')
  assert.ok(isPrivate(first.file), 'devices.json must be owner-only')
  assert.equal(first.authenticated({ headers: { 'x-device-key': first.key } }), true)
  assert.equal(first.authenticated({ headers: { 'x-device-key': 'é'.repeat(64) } }), false)
})

async function openServer(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-device-server-'))
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const base = `http://127.0.0.1:${port}`
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ v: 1, updatedAt: 1, sessionStart: 1, napoleon: { calls: 0, tool: label, log: [] }, agents: [] }))
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), '--engine=claude'], { env: { ...process.env, NAPOLEON_PUBLIC_URL: '', PORT: String(port), NAPOLEON_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stderr.on('data', chunk => { logs += chunk })
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill()
      await exited
    }
  }
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }) })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server failed to start: ${logs}`)), 5000)
    child.stdout.once('data', () => { clearTimeout(timer); resolve() })
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited: ${logs}`)) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
  })
  const page = await (await fetch(base)).text()
  const token = page.match(/name="hq-token" content="([^"]+)"/)[1]
  const headers = { 'content-type': 'application/json', origin: base, 'x-hq-token': token }
  const post = (route, body) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) })
  const key = fs.readFileSync(path.join(dir, 'device.key'), 'utf8').trim()
  const info = await (await fetch(base + '/api/device/info', { headers: { 'x-device-key': key } })).json()
  return { dir, base, key, info, post, stop }
}

test('two HQ servers pair, route mutations and SSE, and report offline without fallback', async t => {
  const first = await openServer(t, 'computer A')
  const second = await openServer(t, 'computer B')
  await t.test('pairing and revealing credentials require browser authorization', async () => {
    assert.equal((await fetch(first.base + '/api/devices/pairing', { method: 'POST', body: '{}' })).status, 403)
    assert.equal((await fetch(first.base + '/api/device/info')).status, 403)
    assert.equal((await fetch(first.base + '/api/projects', { headers: { 'x-device-key': 'x'.repeat(64) } })).status, 403)
    const revealed = await (await first.post('/api/devices/pairing', {})).json()
    assert.equal(revealed.token, first.key)
    assert.equal((await first.post('/api/devices/pair', { url: second.base, token: '0'.repeat(64) })).status, 400)
    assert.equal((await first.post('/api/devices/pair', { url: second.base, token: second.key, label: 'Second computer' })).status, 200)
    const listed = await (await fetch(first.base + '/api/devices')).json()
    assert.equal(listed.devices[1].online, true)
    assert.equal(listed.devices[1].label, 'Second computer')
    assert.equal(JSON.stringify(listed).includes(second.key), false)
    assert.ok(isPrivate(path.join(first.dir, 'devices.json')), 'devices.json must stay owner-only after writes')
  })
  await t.test('selected destinations route reads, writes and live events without cycles', async () => {
    assert.equal((await first.post('/api/devices/select', { id: second.info.id })).status, 200)
    await second.post('/api/devices/pair', { url: first.base, token: first.key })
    await second.post('/api/devices/select', { id: first.info.id })
    assert.deepEqual(await (await fetch(first.base + '/api/projects')).json(), { projects: [] })
    const connection = await (await fetch(first.base + '/api/connection')).json()
    assert.equal(connection.engine, 'claude')
    assert.equal(connection.deviceId, second.info.id)
    assert.equal((await first.post('/api/send', { to: 'napoleon', text: 'Wrong target must not run', deviceId: 'local' })).status, 409)
    assert.equal((await first.post('/api/send', { to: 'napoleon', text: 'Execute on computer B', deviceId: second.info.id })).status, 200)
    assert.equal(fs.existsSync(path.join(first.dir, 'outbox.jsonl')), false)
    const orders = fs.readFileSync(path.join(second.dir, 'outbox.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(orders.at(-1).text, 'Execute on computer B')
    const stream = await fetch(first.base + '/api/events', { signal: AbortSignal.timeout(5000) })
    const reader = stream.body.getReader()
    const { value } = await reader.read()
    assert.match(new TextDecoder().decode(value), /computer B/)
    assert.ok(new TextDecoder().decode(value).includes(second.info.id))
    const changed = JSON.parse(fs.readFileSync(path.join(second.dir, 'state.json'), 'utf8'))
    changed.napoleon.tool = 'computer B live update'
    fs.writeFileSync(path.join(second.dir, 'state.json'), JSON.stringify(changed))
    let live = ''
    while (!live.includes('computer B live update')) {
      const next = await reader.read()
      assert.equal(next.done, false)
      live += new TextDecoder().decode(next.value)
    }
    await reader.cancel()
    assert.equal((await first.post('/api/project/select', { projectId: 'none' })).status, 409)
  })
  await t.test('offline state is explicit and never redirects a task to the local computer', async () => {
    await second.stop()
    const listed = await (await fetch(first.base + '/api/devices')).json()
    assert.equal(listed.selectedId, second.info.id)
    assert.equal(listed.devices[1].online, false)
    const send = await first.post('/api/send', { to: 'napoleon', text: 'Must never execute locally' })
    assert.equal(send.status, 503)
    assert.equal((await send.json()).offline, true)
    assert.equal(fs.existsSync(path.join(first.dir, 'outbox.jsonl')), false)
    assert.equal((await first.post('/api/devices/remove', { id: second.info.id })).status, 200)
    const remaining = await (await fetch(first.base + '/api/devices')).json()
    assert.equal(remaining.selectedId, 'local')
    assert.equal(remaining.devices.length, 1)
  })
})
