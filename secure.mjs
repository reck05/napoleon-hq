// Owner-only files for secrets (access.key, device.key, peer.key, devices.json, mobile config).
// POSIX: mode 0600. On Windows, fix ownership, remove inheritance, grant the
// current identity and verify the exact ACL. Unexpected explicit grants fail closed.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const isWindows = process.platform === 'win32'
const account = () => {
  const identity = execFileSync('whoami', [], { encoding: 'utf8', windowsHide: true }).trim()
  if (!/^[^\\\r\n:]+\\[^\\\r\n:]+$/.test(identity)) throw new Error('No se pudo verificar la identidad de Windows')
  return identity
}

export function ownerOnlyWindowsAcl(output, file, identity, directory = false) {
  const block = output.split(/\r?\n\s*\r?\n/)[0]
  const lines = block.split(/\r?\n/)
  if (!lines[0]?.startsWith(file + ' ')) return false
  const aces = lines.map((line, i) => (i === 0 ? line.slice(file.length) : line).trim()).filter(Boolean)
  if (aces.length !== 1) return false
  const separator = aces[0].lastIndexOf(':')
  const principal = aces[0].slice(0, separator)
  const rights = aces[0].slice(separator + 1)
  return principal.toLowerCase() === identity.toLowerCase()
    && (directory ? rights === '(OI)(CI)(F)' : rights === '(F)')
}

function protectWindows(file, directory) {
  const identity = account()
  execFileSync('icacls', [file, '/setowner', identity], { stdio: 'ignore', windowsHide: true })
  execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${identity}:${directory ? '(OI)(CI)F' : 'F'}`], { stdio: 'ignore', windowsHide: true })
  const out = execFileSync('icacls', [file], { encoding: 'utf8', windowsHide: true })
  if (!ownerOnlyWindowsAcl(out, file, identity, directory)) throw new Error('Windows conserva permisos de otra cuenta. Napoleon no utilizará este archivo hasta corregir sus permisos.')
}

export function protect(file) {
  if (!isWindows) return fs.chmodSync(file, 0o600)
  protectWindows(file, false)
}

export function protectDirectory(dir) {
  if (!isWindows) return fs.chmodSync(dir, 0o700)
  protectWindows(dir, true)
}

/** True when only the owner can reach the file: mode 0600, or on Windows a single, non-inherited ACE for the current user. */
export function isPrivate(file) {
  const directory = fs.statSync(file).isDirectory()
  if (!isWindows) return (fs.statSync(file).mode & 0o777) === (directory ? 0o700 : 0o600)
  const out = execFileSync('icacls', [file], { encoding: 'utf8', windowsHide: true })
  return ownerOnlyWindowsAcl(out, file, account(), directory)
}
