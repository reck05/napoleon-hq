import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('Claude compatibility: browser orders, MCP peers, replies and access checks', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-server-test-'))
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const base = `http://127.0.0.1:${port}`
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ v: 1, updatedAt: 1, sessionStart: 1, napoleon: { calls: 0, log: [] }, agents: [] }))
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), '--engine=claude'], { env: { ...process.env, PORT: String(port), NAPOLEON_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stderr.on('data', c => { logs += c })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve))
      child.kill()
      await exit
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${logs}`)), 5000)
    child.stdout.once('data', () => { clearTimeout(timer); resolve() })
    child.once('error', e => { clearTimeout(timer); reject(e) })
  })
  const token = (await (await fetch(base)).text()).match(/name="hq-token" content="([^"]+)"/)[1]
  const peerKey = fs.readFileSync(path.join(dir, 'peer.key'), 'utf8').trim()
  const pageHeaders = { 'content-type': 'application/json', origin: base, 'x-hq-token': token }
  const peerHeaders = { 'content-type': 'application/json', 'x-peer-key': peerKey }

  await t.test('explicit Claude mode leaves Codex sessions untouched', async () => {
    assert.equal((await (await fetch(base + '/api/health')).json()).engine, 'claude')
    assert.equal((await (await fetch(base + '/api/connection')).json()).engine, 'claude')
    assert.deepEqual((await (await fetch(base + '/api/projects')).json()).projects, [])
    assert.equal(fs.existsSync(path.join(dir, 'bridge.json')), false)
  })
  await t.test('browser orders use the legacy outbox and keep increasing sequence IDs', async () => {
    const response = await fetch(base + '/api/send', { method: 'POST', headers: pageHeaders, body: JSON.stringify({ to: 'napoleon', text: 'Local browser test' }) })
    assert.equal(response.status, 200)
    const result = await response.json()
    const orders = fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(orders.at(-1).seq, result.seq)
    assert.equal(orders.at(-1).text, 'Local browser test')
  })
  await t.test('peer requests preserve sender and receive their correlated reply', async () => {
    const response = await fetch(base + '/api/peer/ask', { method: 'POST', headers: peerHeaders, body: JSON.stringify({ from: 'Test peer', text: 'Local MCP test' }) })
    assert.equal(response.status, 200)
    const { id } = await response.json()
    const orders = fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(orders.at(-1).from, 'Test peer')
    assert.equal(String(orders.at(-1).seq), id)
    assert.ok(orders[1].seq > orders[0].seq)
    const replyRequest = fetch(base + `/api/peer/reply?id=${id}`, { headers: peerHeaders, signal: AbortSignal.timeout(5000) })
    setTimeout(() => fs.writeFileSync(path.join(dir, 'replies', `${id}.json`), JSON.stringify({ text: 'Verified reply', at: 123 })), 100)
    assert.deepEqual(await (await replyRequest).json(), { done: true, text: 'Verified reply', at: 123 })
  })
  await t.test('the actual stdio MCP exposes Claude tools and exchanges a correlated reply', async () => {
    const client = new Client({ name: 'napoleon-test', version: '0.1.0' })
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../peer-mcp.mjs', import.meta.url))], env: { NAPOLEON_URL: base, NAPOLEON_PEER: 'MCP verification', NAPOLEON_PEER_KEY_FILE: path.join(dir, 'peer.key') }, stderr: 'pipe' })
    transport.stderr?.resume()
    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      assert.deepEqual(tools.map(t => t.name).sort(), ['ask_claude', 'claude_status', 'get_claude_reply'])
      const status = await client.callTool({ name: 'claude_status', arguments: {} })
      assert.equal(status.isError, undefined)
      const ask = await client.callTool({ name: 'ask_claude', arguments: { message: 'MCP protocol test', wait_seconds: 0 } })
      const id = ask.content[0].text.match(/\(id (\d+)\)/)[1]
      fs.writeFileSync(path.join(dir, 'replies', `${id}.json`), JSON.stringify({ text: 'MCP verified', at: 456 }))
      const reply = await client.callTool({ name: 'get_claude_reply', arguments: { id, wait_seconds: 0 } })
      assert.equal(reply.content[0].text, 'MCP verified')
    } finally { await client.close() }
  })
  await t.test('invalid keys, origins and hosts cannot submit orders', async () => {
    assert.equal((await fetch(base + '/api/peer/status')).status, 403)
    assert.equal((await fetch(base + '/api/send', { method: 'POST', headers: { ...pageHeaders, origin: 'https://untrusted.example' }, body: '{}' })).status, 403)
    assert.equal((await fetch(base + '/api/peer/ask', { method: 'POST', headers: { ...peerHeaders, origin: 'https://untrusted.example' }, body: '{}' })).status, 403)
    const hostStatus = await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', headers: { Host: 'untrusted.example' } }, r => { r.resume(); resolve(r.statusCode) })
      request.on('error', reject)
    })
    assert.equal(hostStatus, 421)
  })
  await t.test('malformed bodies and traversal reply IDs fail without crashing the server', async () => {
    assert.equal((await fetch(base + '/api/peer/reply?id=../state', { headers: peerHeaders })).status, 400)
    assert.equal((await fetch(base + '/api/send', { method: 'POST', headers: pageHeaders, body: 'null' })).status, 400)
    assert.equal((await fetch(base + '/api/send', { method: 'POST', headers: pageHeaders, body: 'invalid json' })).status, 400)
    assert.equal((await fetch(base + '/api/health')).status, 200)
  })
})
