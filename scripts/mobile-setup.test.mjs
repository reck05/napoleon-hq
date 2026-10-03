import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLaunchAgent, buildWindowsTask, validatePublicUrl, checkServeRoute, officialActionUrl, extractOfficialActionUrl, runtimeCodexCandidates } from './mobile-setup.mjs'

test('LaunchAgent retains spaces and XML characters without shell execution', () => {
  const plist = buildLaunchAgent({ root: '/Users/A & B/Napoleon HQ', node: '/node folder/node', dir: '/data & personal', home: '/Users/A & B' }).replaceAll('\\', '/')
  assert.match(plist, /<string>\/node folder\/node<\/string>/)
  assert.match(plist, /\/Users\/A &amp; B\/Napoleon HQ\/scripts\/mobile-setup.mjs/)
  assert.match(plist, /<key>NAPOLEON_DIR<\/key><string>\/data &amp; personal/)
  assert.doesNotMatch(plist, /\/bin\/sh|\/bin\/bash/)
})

test('Windows scheduled task quotes script paths and encodes XML safely', () => {
  const task = buildWindowsTask({ root: 'C:\\Projects\\A & B', node: 'C:\\Program Files\\node.exe', dir: 'C:\\Users\\Data & Space' })
  assert.match(task, /C:\\Program Files\\node.exe/)
  assert.match(task, /&quot;.*mobile-setup.mjs&quot; run --dir &quot;C:\\Users\\Data &amp; Space&quot;/)
  assert.match(task, /LeastPrivilege/)
  assert.match(task, /InteractiveToken/)
})

test('private public URL rejects untrusted origins and unusual URLs', () => {
  assert.equal(validatePublicUrl('https://mac.example.ts.net/'), 'https://mac.example.ts.net')
  for (const url of ['http://mac.example.ts.net', 'https://example.com', 'https://mac.example.ts.net/path', 'https://user@mac.example.ts.net', 'https://mac.example.ts.net:4517', 'https://mac.example.ts.net/?token=secret']) assert.throws(() => validatePublicUrl(url))
})


test('Serve refuses to replace another service or reuse a public Funnel', () => {
  const url = 'https://mac.example.ts.net', target = 'http://127.0.0.1:4517'
  assert.doesNotThrow(() => checkServeRoute({}, url, target))
  assert.doesNotThrow(() => checkServeRoute({ Web: { 'mac.example.ts.net:443': { Handlers: { '/': { Proxy: target } } } } }, url, target))
  assert.throws(() => checkServeRoute({ AllowFunnel: { 'mac.example.ts.net:443': true } }, url, target), /Funnel/)
  assert.throws(() => checkServeRoute({ TCP: { '443': { TCPForward: 'localhost:1234' } } }, url, target), /TCP/)
  assert.throws(() => checkServeRoute({ Web: { 'mac.example.ts.net:443': { Handlers: { '/': { Proxy: 'http:\/\/127.0.0.1:3000' } } } } }, url, target), /otro servicio/)
})


test('only official Tailscale login URLs become user actions', () => {
  assert.equal(officialActionUrl('https://login.tailscale.com/a/example'), 'https://login.tailscale.com/a/example')
  for (const url of ['https://login.tailscale.com.evil.test/action', 'https://user@login.tailscale.com/action', 'http://login.tailscale.com/action', 'https://login.tailscale.com:4517/action', 'javascript:alert(1)']) assert.equal(officialActionUrl(url), '')
  assert.equal(extractOfficialActionUrl('Enable HTTPS: https://login.tailscale.com/f/example\nDetails at https://evil.test/token'), 'https://login.tailscale.com/f/example')
  assert.equal(extractOfficialActionUrl('https://login.tailscale.com.evil.test/action'), '')
})


test('per-user Codex executable lookup covers optional native Windows and Mac packages', () => {
  const windows = runtimeCodexCandidates('/private data', 'win32', 'x64').map(candidate => candidate.replaceAll('\\', '/'))
  assert.ok(windows.some(candidate => candidate.includes('codex-win32-x64') && candidate.endsWith('vendor/x86_64-pc-windows-msvc/bin/codex.exe')))
  const mac = runtimeCodexCandidates('/private data', 'darwin', 'arm64').map(candidate => candidate.replaceAll('\\', '/'))
  assert.ok(mac.some(candidate => candidate.includes('codex-darwin-arm64') && candidate.endsWith('vendor/aarch64-apple-darwin/bin/codex')))
  assert.deepEqual(runtimeCodexCandidates('/private data', 'unknown', 'x64'), [])
})
