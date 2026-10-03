import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ClaudeBridge } from '../claude-bridge.mjs'
import { AssistantBridge } from '../assistant-bridge.mjs'

function fixture(t, queryFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-claude-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify([{ id: 'p', name: 'Project', kind: 'local', path: dir }]))
  fs.writeFileSync(path.join(dir, 'coordinator.md'), 'Verify the deliverable.')
  return { dir, bridge: new ClaudeBridge({ dir, root: dir, queryFn, authFn: async () => true }) }
}

test('Claude uses the selected folder, streams responses and resumes HQ sessions', async t => {
  const calls = []
  const { dir, bridge } = fixture(t, async function* (args) {
    calls.push(args)
    yield { type: 'system', subtype: 'init', session_id: 'session' }
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Verified.' }] } }
    yield { type: 'result', is_error: false }
  })
  await bridge.select('p')
  await bridge.send('napoleon', 'Verify it')
  await bridge.running
  assert.equal(calls[0].options.cwd, dir)
  assert.equal(calls[0].options.permissionMode, 'default')
  assert.equal(bridge.state().napoleon.convo.at(-1).text, 'Verified.')
  await bridge.send('napoleon', 'Continue')
  await bridge.running
  assert.equal(calls[1].options.resume, 'session')
  assert.equal(bridge.connection().busy, false)
})

test('tool approval waits for the phone response and interruption denies pending tools', async t => {
  const { bridge } = fixture(t)
  const controller = new AbortController()
  const approval = bridge.permission('Bash', { command: 'pwd' }, { signal: controller.signal })
  const request = bridge.connection().requests[0]
  assert.equal(request.params.command, 'pwd')
  bridge.answer(request.id, 'accept')
  assert.deepEqual(await approval, { behavior: 'allow', updatedInput: { command: 'pwd' } })
  assert.throws(() => bridge.answer(request.id, 'accept'), /ya no está/)
  const pending = bridge.permission('Edit', { file_path: '/tmp/example' }, { signal: controller.signal })
  controller.abort()
  assert.equal((await pending).behavior, 'deny')
  assert.equal(bridge.connection().requests.length, 0)
})

test('an unauthenticated account and unrelated agents cannot execute tasks', async t => {
  const { bridge } = fixture(t)
  await bridge.select('p')
  await assert.rejects(bridge.send('other-session', 'Work'), /coordinador/)
  bridge.authFn = async () => false
  await assert.rejects(bridge.send('napoleon', 'Work'), /Inicia sesión/)
  assert.equal(bridge.state().napoleon.convo.length, 0)
})

test('switching engines rejects invalid names and active work', async t => {
  const { dir } = fixture(t)
  const bridge = new AssistantBridge({ dir, root: dir })
  await assert.rejects(bridge.selectEngine('__proto__'), /no válido/)
  bridge.bridges.codex.connection = () => ({ busy: true })
  await assert.rejects(bridge.selectEngine('claude'), /Detén/)
  assert.equal(bridge.engine, 'codex')
})
