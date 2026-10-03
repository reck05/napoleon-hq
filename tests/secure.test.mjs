import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isPrivate, protect, protectDirectory, ownerOnlyWindowsAcl } from '../secure.mjs'

test('protect makes a fresh file owner-only, and isPrivate tells the difference', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-secure-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'secret.key')
  fs.writeFileSync(file, 'x', { mode: 0o644 })
  // a new file inherits the folder's ACL on Windows and is 0644 here: both readable by others
  assert.equal(isPrivate(file), false)
  protect(file)
  assert.equal(isPrivate(file), true)
  assert.equal(fs.readFileSync(file, 'utf8'), 'x')
})

test('private directories protect transcripts as well as credentials', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napoleon-private-dir-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  protectDirectory(dir)
  assert.equal(isPrivate(dir), true)
})

test('Windows ACL validation rejects extra principals, other domains and inherited or denied access', () => {
  const file = 'C:\\Users\\marti\\secret.key'
  const identity = 'COMPUTER\\marti'
  const output = ace => `${file} ${ace}\r\n\r\nSe procesaron correctamente 1 archivos\r\n`
  assert.equal(ownerOnlyWindowsAcl(output('COMPUTER\\marti:(F)'), file, identity), true)
  assert.equal(ownerOnlyWindowsAcl(output('computer\\MARTI:(F)'), file, identity), true)
  for (const ace of ['DOMAIN\\marti:(F)', 'COMPUTER\\marti:(I)(F)', 'COMPUTER\\marti:(DENY)(F)', 'COMPUTER\\marti:(RX)', 'COMPUTER\\marti:(F)\r\n               Everyone:(F)']) assert.equal(ownerOnlyWindowsAcl(output(ace), file, identity), false)
  assert.equal(ownerOnlyWindowsAcl(output('COMPUTER\\marti:(OI)(CI)(F)'), file, identity, true), true)
  assert.equal(ownerOnlyWindowsAcl('different-path COMPUTER\\marti:(F)', file, identity), false)
})
