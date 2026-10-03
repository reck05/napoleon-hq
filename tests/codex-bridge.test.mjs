import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CodexBridge } from '../codex-bridge.mjs'

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify([{ id: 'project', name: 'Example', kind: 'local', path: dir }]))
  fs.writeFileSync(path.join(dir, 'coordinator.md'), 'Define observable success criteria and verify the deliverable.')
  const bridge = new CodexBridge({ dir, root: dir })
  bridge.connected = true
  bridge.authenticated = true
  const calls = []
  bridge.rpc = async (method, params) => {
    calls.push({ method, params })
    return { thread: { id: params.threadId || 'root', createdAt: 123, turns: [] }, turn: { id: 'turn' } }
  }
  return { dir, bridge, calls }
}

test('a project receives coordinator instructions and resumes its own durable session', async t => {
  const { dir, bridge, calls } = fixture(t)
  await bridge.select('project')
  assert.match(calls[0].params.developerInstructions, /observable success/)
  assert.equal(calls[0].params.cwd, dir)
  assert.equal(calls[0].params.approvalPolicy, 'on-request')
  const resumed = new CodexBridge({ dir, root: dir })
  resumed.connected = resumed.authenticated = true
  resumed.rpc = bridge.rpc
  await resumed.select('project')
  assert.equal(calls.at(-1).method, 'thread/resume')
  assert.equal(calls.at(-1).params.threadId, 'root')
})

test('unavailable or cloud projects cannot create a local Codex session', async t => {
  const { bridge, calls } = fixture(t)
  bridge.catalog.push({ id: 'cloud', name: 'Cloud', kind: 'chatgpt', path: null })
  await assert.rejects(bridge.select('cloud'), /carpeta local/)
  await assert.rejects(bridge.select('unknown'), /carpeta local/)
  assert.equal(calls.length, 0)
})

test('messages start a turn, steer while active and return to idle after completion', async t => {
  const { bridge, calls } = fixture(t)
  await bridge.select('project')
  await bridge.send('napoleon', 'Check the deliverable')
  assert.equal(calls.at(-1).method, 'turn/start')
  assert.equal(bridge.connection().busy, true)
  await bridge.send('napoleon', 'Also verify the numbers')
  assert.equal(calls.at(-1).method, 'turn/steer')
  assert.equal(calls.at(-1).params.expectedTurnId, 'turn')
  bridge.event('turn/completed', { threadId: 'root', turn: { id: 'turn', status: 'completed' } })
  assert.equal(bridge.connection().busy, false)
  await assert.rejects(bridge.send('unrelated-desktop-chat', 'Change this'), /no pertenece/)
})

test('native subAgentActivity events create the tree and recover the child answer', async t => {
  const { bridge } = fixture(t)
  await bridge.select('project')
  bridge.rpc = async (_, p) => ({ thread: { id: p.threadId, createdAt: 123, agentNickname: 'Verifier', turns: [{ status: 'completed', items: [{ type: 'agentMessage', id: 'answer', text: 'Seven verified sections' }] }] } })
  const activity = { type: 'subAgentActivity', id: 'spawn', kind: 'started', agentThreadId: 'child', agentPath: '/root/verifier' }
  bridge.event('item/started', { threadId: 'root', item: activity })
  bridge.event('item/completed', { threadId: 'root', item: activity })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(bridge.state().agents.length, 1)
  assert.equal(bridge.state().agents[0].description, 'Verifier')
  assert.equal(bridge.state().agents[0].answer, 'Seven verified sections')
  assert.equal(bridge.state().agents[0].status, 'completed')
  assert.equal(bridge.state().agents[0].convo.length, 1)
})

test('legacy collab events keep descendants and terminal failures accurate', async t => {
  const { bridge } = fixture(t)
  await bridge.select('project')
  bridge.event('item/completed', { threadId: 'root', item: { type: 'collabAgentToolCall', id: 'spawn', receiverThreadIds: ['child'], prompt: 'Compare two sources', agentsStates: {} } })
  bridge.event('item/completed', { threadId: 'child', item: { type: 'collabAgentToolCall', id: 'nested', receiverThreadIds: ['grandchild'], prompt: 'Read the source', agentsStates: { grandchild: { status: 'errored' } } } })
  const rows = bridge.state().agents
  assert.equal(rows.find(a => a.id === 'grandchild').parentId, 'child')
  assert.equal(rows.find(a => a.id === 'grandchild').status, 'failed')
})

test('permission requests require an explicit answer and cannot be replayed', t => {
  const { bridge } = fixture(t)
  const responses = []
  bridge.write = message => responses.push(message)
  bridge.receive({ id: 5, method: 'item/commandExecution/requestApproval', params: { command: 'outside-workspace command' } })
  assert.equal(responses.length, 0)
  bridge.answer(5, 'decline')
  assert.deepEqual(responses[0], { id: 5, result: { decision: 'decline' } })
  assert.throws(() => bridge.answer(5, 'accept'), /ya no está pendiente/)
})
