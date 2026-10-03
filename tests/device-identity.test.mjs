import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { DeviceManager } from '../devices.mjs'

const TOKEN = 'a'.repeat(64)
const peer = () => ({ id: crypto.randomUUID(), engine: 'codex', label: 'Second computer' })
const response = info => new Response(JSON.stringify(info), { headers: { 'content-type': 'application/json' } })
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-identity-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return { dir, manager: new DeviceManager({ dir, port: 4517, engine: 'codex' }) }
}
const pairAt = (manager, url = 'https://second.tailnet.ts.net') => manager.pair({ url, token: TOKEN })

test('valid UUID identity survives pairing, selection and reload without exposing tokens', async t => {
  const { dir, manager } = fixture(t)
  const info = peer()
  manager.request = async () => response(info)
  const result = await pairAt(manager)
  assert.equal(result.device.id, info.id)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
  manager.select(info.id)
  assert.equal(manager.selected().id, info.id)
  const reloaded = new DeviceManager({ dir, port: 4517, engine: 'codex' })
  assert.equal(reloaded.selected().id, info.id)
  assert.equal(reloaded.data.id, manager.data.id)
  manager.select('local')
  assert.equal(manager.selected(), null)
})

test('reserved, malformed and own peer identities cannot replace the local computer', async t => {
  const { manager } = fixture(t)
  const original = JSON.stringify(manager.data)
  for (const id of ['local', '', null, 12, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', '00000000-0000-1000-8000-000000000000', '00000000-0000-4000-7000-000000000000', manager.data.id]) {
    manager.request = async () => response({ id, engine: 'codex' })
    await assert.rejects(pairAt(manager), /identidad|misma computadora/)
    assert.equal(JSON.stringify(manager.data), original)
    assert.equal(manager.selected(), null)
  }
})

test('a peer changing the identity at an existing address is rejected until explicitly disconnected', async t => {
  const { manager } = fixture(t)
  const first = peer()
  manager.request = async () => response(first)
  await pairAt(manager)
  manager.select(first.id)
  const other = peer()
  manager.request = async () => response(other)
  await assert.rejects(pairAt(manager), /identidad.*ha cambiado/)
  assert.equal(manager.selected().id, first.id)
  const status = await manager.probe(manager.selected())
  assert.equal(status.online, false)
  assert.match(status.error, /otra computadora/)
  manager.remove(first.id)
  const paired = await pairAt(manager)
  assert.equal(paired.device.id, other.id)
})

test('invalid persisted identities, destinations and credentials fail without resetting to local', async t => {
  const { dir, manager } = fixture(t)
  const info = peer()
  const valid = { id: manager.data.id, selectedId: info.id, devices: [{ ...info, url: 'https://second.tailnet.ts.net', token: TOKEN }] }
  const cases = [
    { ...valid, id: 'local' },
    { ...valid, id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
    { ...valid, devices: null },
    { ...valid, selectedId: crypto.randomUUID() },
    { ...valid, selectedId: null },
    { ...valid, devices: [{ ...valid.devices[0], id: 'local' }], selectedId: 'local' },
    { ...valid, devices: [{ ...valid.devices[0], id: valid.id }], selectedId: valid.id },
    { ...valid, devices: [valid.devices[0], valid.devices[0]] },
    { ...valid, devices: [{ ...valid.devices[0], token: 'short' }] },
    { ...valid, devices: [{ ...valid.devices[0], url: 'http://192.168.1.20' }] },
    { ...valid, devices: [{ ...valid.devices[0], url: 'https://second.tailnet.ts.net/path' }] },
    { ...valid, devices: [{ ...valid.devices[0], engine: 'unknown' }] },
  ]
  const file = path.join(dir, 'devices.json')
  for (const invalid of cases) {
    const content = JSON.stringify(invalid)
    fs.writeFileSync(file, content)
    assert.throws(() => new DeviceManager({ dir, port: 4517, engine: 'codex' }), /registro de computadoras no es válido/)
    assert.equal(fs.readFileSync(file, 'utf8'), content)
  }
})

test('unknown in-memory selection throws rather than returning the local destination', t => {
  const { manager } = fixture(t)
  manager.data.selectedId = crypto.randomUUID()
  assert.throws(() => manager.selected(), /seleccionada no está registrada/)
  manager.data.selectedId = 'local'
  manager.data.devices.push({ id: 'local' })
  assert.equal(manager.selected(), null)
})
