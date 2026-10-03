// Owner-only files for secrets (access.key, device.key, peer.key, devices.json, mobile config).
// POSIX: mode 0600. Windows ignores POSIX modes (it reports 0666), so the ACL is reset instead:
// inheritance removed and full control granted to the current user alone.
import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const isWindows = process.platform === 'win32'
const user = () => os.userInfo().username
const account = () => (process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user()}` : user())

export function protect(file) {
  if (!isWindows) return fs.chmodSync(file, 0o600)
  execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${account()}:F`], { stdio: 'ignore', windowsHide: true })
}

/** True when only the owner can reach the file: mode 0600, or on Windows a single, non-inherited ACE for the current user. */
export function isPrivate(file) {
  if (!isWindows) return (fs.statSync(file).mode & 0o777) === 0o600
  const out = execFileSync('icacls', [file], { encoding: 'utf8', windowsHide: true })
  // first line is "<path> <ACE>", the next ones are indented ACEs, then a blank line and a (localized) summary
  const block = out.split(/\r?\n\s*\r?\n/)[0]
  const aces = block.split(/\r?\n/).map((line, i) => (i === 0 ? line.slice(file.length) : line).trim()).filter(Boolean)
  if (aces.length !== 1) return false
  const [principal, rights] = [aces[0].slice(0, aces[0].lastIndexOf(':')), aces[0].slice(aces[0].lastIndexOf(':') + 1)]
  const name = principal.split('\\').pop().toLowerCase()
  return name === user().toLowerCase() && !rights.includes('(I)') && rights.includes('(F)')
}
