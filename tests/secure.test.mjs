import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isPrivate, protect } from '../secure.mjs'

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
