#!/usr/bin/env node
// Personal configuration stays outside the repository. No shell interpolation is used.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LABEL = 'com.napoleon.hq'
const BUNDLED_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
export const dataDir = () => process.env.NAPOLEON_DIR || path.join(os.homedir(), '.codex', 'napoleon')
const configPath = () => path.join(dataDir(), 'setup.json')
const mobilePath = () => path.join(dataDir(), 'mobile.json')
const mobileStatusPath = () => path.join(dataDir(), 'mobile-status.json')
const escapeXml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]))
const run = (command, args, extra = {}) => spawnSync(command, args, { encoding: 'utf8', timeout: 15000, ...extra })
export function runtimeCodexCandidates(dir = dataDir(), platform = process.platform, arch = process.arch) {
  const triples = { 'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin', 'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc', 'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl' }
  const triple = triples[`${platform}-${arch}`]; if (!triple) return []
  const modules = path.join(dir, 'runtime', 'node_modules', '@openai')
  const packageName = `codex-${platform}-${arch}`
  return [path.join(modules, 'codex'), path.join(modules, packageName), path.join(modules, 'codex', 'node_modules', '@openai', packageName)].flatMap(root => ['bin', 'codex'].map(binDir => path.join(root, 'vendor', triple, binDir, platform === 'win32' ? 'codex.exe' : 'codex')))
}
async function runInteractive(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd: ROOT })
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('El preparador no pudo completar este paso. Puedes volver a abrirlo para reintentarlo.')))
  })
}
async function ensureCodex(login) {
  let binary = findExecutable('codex')
  if (!binary) {
    const npmBinary = findExecutable('npm')
    const candidates = [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    if (npmBinary) { try { candidates.unshift(fs.realpathSync(npmBinary)) } catch { /* use Node installation candidates */ } }
    const npmCli = candidates.find(candidate => candidate.endsWith('npm-cli.js') && fs.existsSync(candidate))
    if (!npmCli) throw new Error('Falta npm. Reinstala Node.js LTS con sus componentes predeterminados y vuelve a abrir el preparador.')
    console.log('Preparando Codex en tu cuenta. No necesito permisos de administrador.')
    await runInteractive(process.execPath, [npmCli, 'install', '--prefix', path.join(dataDir(), 'runtime'), '@openai/codex'])
    binary = findExecutable('codex')
    if (!binary) throw new Error('Codex se descargó, pero falta su ejecutable para este sistema. Conservé la instalación para revisarla.')
  }
  if (login && run(binary, ['login', 'status']).status !== 0) {
    console.log('Entra en Codex en la página del navegador. Al terminar continuaré preparando Napoleon.')
    await runInteractive(binary, ['login'])
  }
  console.log('Codex está preparado.')
}
export function findExecutable(name) {
  const paths = (process.env.PATH || '').split(path.delimiter)
  const candidates = paths.flatMap(dir => process.platform === 'win32' ? ['.exe'].map(ext => path.join(dir, name + ext)) : [path.join(dir, name)])
  if (name === 'tailscale') candidates.push('/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe')
  if (name === 'codex') {
    candidates.unshift(process.env.CODEX_BIN || BUNDLED_CODEX)
    candidates.push(...runtimeCodexCandidates())
    if (process.platform === 'win32') {
      const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
      const packageName = process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64'
      for (const dir of paths) {
        const core = path.join(dir, 'node_modules', '@openai', 'codex')
        for (const root of [core, path.join(core, 'node_modules', '@openai', packageName), path.join(dir, 'node_modules', '@openai', packageName)]) {
          candidates.push(path.join(root, 'vendor', triple, 'bin', 'codex.exe'), path.join(root, 'vendor', triple, 'codex', 'codex.exe'))
        }
      }
    }
  }
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile() && (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(candidate))) || null
}
export function officialActionUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'login.tailscale.com' && !url.username && !url.password && !url.port ? url.href : '' } catch { return '' }
}
export function extractOfficialActionUrl(value) {
  const urls = String(value).match(/https:\/\/login\.tailscale\.com\/[^\s"'<>]+/g) || []
  return urls.map(officialActionUrl).find(Boolean) || ''
}
function writeMobileStatus(phase, message, actionUrl = '') {
  const status = { phase, message, ...(officialActionUrl(actionUrl) ? { actionUrl: officialActionUrl(actionUrl) } : {}) }
  const contents = JSON.stringify(status, null, 2) + '\n'
  try { if (fs.readFileSync(mobileStatusPath(), 'utf8') === contents) return } catch { /* initial status */ }
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  fs.writeFileSync(mobileStatusPath(), contents, { mode: 0o600 })
  if (process.platform !== 'win32') fs.chmodSync(mobileStatusPath(), 0o600)
}
function updateNetworkStatus(state, config) {
  if (!state.installed) writeMobileStatus('error', 'Instala Tailscale en este equipo para conectar tu teléfono')
  else if (state.state !== 'Running' || !state.url) writeMobileStatus('login', 'Entra en Tailscale para conectar tu teléfono', state.authUrl)
  else if (config.publicUrl) writeMobileStatus('ready', 'Conexión privada preparada. Abre esta dirección con Tailscale conectado en tu teléfono')
}
export function validatePublicUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port || !url.hostname.endsWith('.ts.net')) throw new Error('La dirección debe ser HTTPS de Tailscale, sin ruta ni contraseña: https://equipo.red.ts.net')
  return url.origin
}
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return { port: 4517, keepAwakeOnPower: true }
    throw new Error(`No puedo leer ${configPath()}: ${error.message}`)
  }
}
function saveConfig(config) {
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  if (config.publicUrl) fs.writeFileSync(mobilePath(), JSON.stringify({ publicUrl: config.publicUrl }, null, 2) + '\n', { mode: 0o600 })
  if (process.platform !== 'win32') fs.chmodSync(configPath(), 0o600)
}
function tailState() {
  const binary = findExecutable('tailscale')
  if (!binary) return { installed: false, state: 'NotInstalled', devices: [] }
  const result = run(binary, ['status', '--json'])
  let status
  try { status = JSON.parse(result.stdout) } catch { return { installed: true, state: 'Unavailable', devices: [], error: 'Tailscale no responde. Abre su aplicación.' } }
  return { installed: true, state: status.BackendState, name: status.Self?.HostName || '', authUrl: officialActionUrl(status.AuthURL), url: status.Self?.DNSName ? `https://${status.Self.DNSName.replace(/\.$/, '')}` : '', devices: Object.values(status.Peer || {}).map(peer => ({ name: peer.HostName, url: peer.DNSName ? `https://${peer.DNSName.replace(/\.$/, '')}` : '', os: peer.OS, online: !!peer.Online })) }
}
export function checkServeRoute(service, url, target) {
  const address = `${new URL(url).hostname}:443`
  if (service.AllowFunnel?.[address]) throw new Error('Esta dirección tiene acceso público Funnel activado. Desactívalo antes de compartir Napoleon en privado.')
  if (service.TCP?.['443'] && !service.TCP['443'].HTTPS) throw new Error('Otro servicio TCP ya usa el puerto 443 de Tailscale. No lo he sustituido.')
  const route = service.Web?.[address]?.Handlers?.['/']
  if (route && route.Proxy !== target) throw new Error('Tailscale ya comparte otro servicio en esta dirección. No lo he sustituido.')
}
export function buildLaunchAgent({ root = ROOT, node = process.execPath, dir = dataDir(), home = os.homedir() } = {}) {
  const args = [node, path.join(root, 'scripts', 'mobile-setup.mjs'), 'run']
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array>${args.map(arg => `<string>${escapeXml(arg)}</string>`).join('')}</array>\n<key>WorkingDirectory</key><string>${escapeXml(root)}</string>\n<key>EnvironmentVariables</key><dict><key>NAPOLEON_DIR</key><string>${escapeXml(dir)}</string><key>PATH</key><string>${escapeXml([path.dirname(node), path.join(home, '.npm-global', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':'))}</string></dict>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>\n<key>StandardOutPath</key><string>${escapeXml(path.join(dir, 'service.log'))}</string>\n<key>StandardErrorPath</key><string>${escapeXml(path.join(dir, 'service-error.log'))}</string>\n</dict></plist>\n`
}
export function buildWindowsTask({ root = ROOT, node = process.execPath, dir = dataDir() } = {}) {
  const script = path.join(root, 'scripts', 'mobile-setup.mjs')
  // Config directory is explicit because the scheduled task has no inherited shell variables.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers><Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>10</Count></RestartOnFailure></Settings><Actions Context="Author"><Exec><Command>${escapeXml(node)}</Command><Arguments>${escapeXml(`"${script}" run --dir "${dir}"`)}</Arguments><WorkingDirectory>${escapeXml(root)}</WorkingDirectory></Exec></Actions></Task>\n`
}
function checked(command, args, extra) {
  const result = run(command, args, extra)
  if (result.error || result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || 'Error de comando').trim())
  return result.stdout.trim()
}
async function health(port) {
  try { const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) }); return response.ok ? await response.json() : { ok: false, status: response.status } } catch { return { ok: false } }
}
function initProjects() {
  const file = path.join(dataDir(), 'projects.json')
  if (fs.existsSync(file)) return
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, JSON.stringify([{ id: 'napoleon-local', name: 'Napoleon', kind: 'local', path: ROOT }], null, 2) + '\n', { mode: 0o600, flag: 'wx' })
}
async function configureServe(config, state, quiet = false) {
  if (!state.installed) throw new Error('Instala Tailscale desde https://tailscale.com/download y entra con tu cuenta.')
  if (state.state !== 'Running' || !state.url) throw new Error('Abre Tailscale, activa la conexión e inicia sesión. El servicio automático completará la conexión cuando entres.')
  const publicUrl = validatePublicUrl(state.url)
  const binary = findExecutable('tailscale')
  const existing = checked(binary, ['serve', 'status', '--json'])
  const service = existing ? JSON.parse(existing) : {}
  const target = `http://127.0.0.1:${config.port || 4517}`
  checkServeRoute(service, publicUrl, target)
  const output = checked(binary, ['serve', '--bg', '--https=443', '--yes', target], { timeout: 30000 })
  saveConfig({ ...config, publicUrl })
  writeMobileStatus('ready', 'Conexión privada preparada. Abre esta dirección con Tailscale conectado en tu teléfono')
  if (!quiet) console.log(`${output}\nDirección privada: ${publicUrl}\nEl teléfono necesita Tailscale con la misma cuenta. El servicio automático aplicará la dirección.`)
}
export async function main(args = process.argv.slice(2)) {
  const [action = 'status'] = args
  const option = name => { const index = args.indexOf(name); if (index !== -1 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error(`Falta un valor para ${name}`); return index === -1 ? undefined : args[index + 1] }
  if (option('--dir')) process.env.NAPOLEON_DIR = option('--dir')
  const config = readConfig()
  if (action === 'ensure-codex') { await ensureCodex(args.includes('--login')); return }
  if (action === 'status') {
    const codex = findExecutable('codex')
    const status = { machine: os.hostname(), platform: process.platform, node: process.version, codex: !!codex, codexAuthenticated: !!codex && run(codex, ['login', 'status']).status === 0, app: await health(config.port || 4517), tailscale: tailState(), publicUrl: config.publicUrl || '', automaticStart: fs.existsSync(process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`) : path.join(dataDir(), 'windows-task.xml')), keepAwakeOnPower: process.platform === 'darwin' ? config.keepAwakeOnPower !== false : null }
    delete status.tailscale.authUrl
    if (process.platform === 'darwin') { status.model = run('/usr/sbin/sysctl', ['-n', 'hw.model']).stdout?.trim(); status.powerSettings = run('/usr/bin/pmset', ['-g', 'custom']).stdout?.trim() }
    console.log(JSON.stringify(status, null, 2)); return
  }
  if (action === 'setup') {
    initProjects(); saveConfig(config)
    const state = tailState()
    updateNetworkStatus(state, config)
    if (state.state === 'Running' && state.url) await main(['serve'])
    else console.log('Acceso teléfono pendiente: abre Tailscale e inicia sesión. Napoleon local sí está preparado.')
    if (!findExecutable('codex')) console.log('Codex pendiente: instala Codex o la aplicación Codex e inicia sesión antes de enviar tareas.')
    if (process.platform === 'darwin' && fs.existsSync(path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)) && (await health(config.port || 4517)).ok) { console.log('Napoleon ya está funcionando con inicio automático.'); return }
    await main(['autostart']); return
  }
  if (action === 'configure') {
    if (option('--public-url')) config.publicUrl = validatePublicUrl(option('--public-url'))
    if (option('--port')) { const port = Number(option('--port')); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Puerto inválido (1024–65535)'); config.port = port }
    if (args.includes('--allow-sleep')) config.keepAwakeOnPower = false
    if (args.includes('--keep-awake')) config.keepAwakeOnPower = true
    saveConfig(config); console.log(`Napoleon configurado. ${config.publicUrl || 'Acceso local; falta conectar Tailscale.'}`); return
  }
  if (action === 'run' || action === 'start') {
    if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('Primero ejecuta npm install y npm run build en la carpeta de Napoleon.')
    if ((await health(config.port || 4517)).ok) throw new Error('Napoleon ya está funcionando. Detén la instancia anterior antes de activar el inicio automático.')
    let current, monitor, stopping = false, checking = false, retryAt = 0
    const signature = value => JSON.stringify([value.port || 4517, value.publicUrl || '', value.keepAwakeOnPower !== false])
    let applied = signature(config)
    const updateAwake = (instance, value) => {
      if (process.platform !== 'darwin') return
      const onPower = run('/usr/bin/pmset', ['-g', 'batt']).stdout?.includes("'AC Power'")
      const shouldStayAwake = value.keepAwakeOnPower !== false && onPower
      if (!shouldStayAwake) { instance.awake?.kill(); instance.awake = null }
      else if (!instance.awake && instance.child.pid) instance.awake = spawn('/usr/bin/caffeinate', ['-is', '-w', String(instance.child.pid)], { stdio: 'ignore' })
    }
    const launch = value => {
      const env = { ...process.env, PORT: String(value.port || 4517), NAPOLEON_DIR: dataDir() }
      if (value.publicUrl) env.NAPOLEON_PUBLIC_URL = validatePublicUrl(value.publicUrl)
      const codex = findExecutable('codex'); if (codex) env.CODEX_BIN = codex
      const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, env, stdio: 'inherit' })
      // Process-scoped assertions prevent idle sleep only on AC, without changing pmset.
      const instance = { child, awake: null }; current = instance; updateAwake(instance, value)
      child.on('error', error => { instance.awake?.kill(); if (current === instance) { clearInterval(monitor); console.error(error.message); process.exitCode = 1 } })
      child.on('exit', (code, signal) => { instance.awake?.kill(); if (current === instance) { clearInterval(monitor); process.exitCode = stopping ? 0 : code ?? (signal ? 1 : 0) } })
    }
    const stopCurrent = async () => {
      const old = current; current = null; old?.awake?.kill()
      if (!old || old.child.exitCode !== null || old.child.signalCode !== null) return
      await new Promise(resolve => {
        const timeout = setTimeout(() => old.child.kill('SIGKILL'), 3000); timeout.unref()
        old.child.once('exit', () => { clearTimeout(timeout); resolve() }); old.child.kill('SIGTERM')
      })
    }
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; clearInterval(monitor); void stopCurrent() })
    updateNetworkStatus(tailState(), config)
    launch(config)
    monitor = setInterval(async () => {
      if (checking || stopping || !current) return
      checking = true
      try {
        let latest = readConfig()
        updateAwake(current, latest)
        const state = tailState()
        updateNetworkStatus(state, latest)
        if (!latest.publicUrl && Date.now() >= retryAt) {
          if (state.state === 'Running' && state.url) {
            try { writeMobileStatus('https', 'Preparando la dirección HTTPS privada'); await configureServe(latest, state, true); latest = readConfig(); console.log('Acceso privado desde el teléfono preparado.'); }
            catch (error) {
              retryAt = Date.now() + 300000
              const action = extractOfficialActionUrl(error.message)
              writeMobileStatus(action ? 'https' : 'error', action ? 'Habilita HTTPS en Tailscale para conectar tu teléfono' : 'Tailscale todavía no pudo preparar HTTPS privado. Conservo Napoleon funcionando y volveré a intentarlo', action)
              console.error('Acceso teléfono pendiente. Consulta Tus computadoras en Napoleon. Reintento automático en 5 min.')
            }
          }
        }
        if (signature(latest) !== applied && !stopping) { await stopCurrent(); if (!stopping) { launch(latest); applied = signature(latest) } }
      } catch { console.error('No puedo leer la configuración de Napoleon; conservo el servicio actual.') }
      finally { checking = false }
    }, 20000)
    return
  }
  if (action === 'autostart') {
    if (!args.includes('--dry-run') && (await health(config.port || 4517)).ok) throw new Error('Napoleon ya está abierto. Detén la instancia actual y repite setup para activar el inicio automático.')
    const platform = option('--platform') || process.platform
    const contents = platform === 'darwin' ? buildLaunchAgent() : platform === 'win32' ? buildWindowsTask() : null
    if (!contents) throw new Error('Inicio automático disponible en macOS y Windows. En Linux usa node scripts/mobile-setup.mjs start con tu gestor de servicios.')
    if (args.includes('--dry-run')) { console.log(contents); return }
    if (platform !== process.platform) throw new Error('Usa --platform solamente junto a --dry-run.')
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
    if (platform === 'darwin') {
      const dir = path.join(os.homedir(), 'Library', 'LaunchAgents'); fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, `${LABEL}.plist`); fs.writeFileSync(target, contents, { mode: 0o600 })
      const domain = `gui/${process.getuid()}`
      run('/bin/launchctl', ['bootout', `${domain}/${LABEL}`])
      checked('/bin/launchctl', ['bootstrap', domain, target]); checked('/bin/launchctl', ['kickstart', `${domain}/${LABEL}`])
    } else {
      const target = path.join(dataDir(), 'windows-task.xml'); fs.writeFileSync(target, contents, { mode: 0o600 })
      checked('schtasks.exe', ['/Create', '/TN', 'Napoleon HQ', '/XML', target, '/F']); checked('schtasks.exe', ['/Run', '/TN', 'Napoleon HQ'])
    }
    console.log('Napoleon se iniciará al entrar en tu cuenta.'); return
  }
  if (action === 'remove-autostart') {
    if (process.platform === 'darwin') { run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]); fs.rmSync(path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`), { force: true }) }
    else if (process.platform === 'win32') { checked('schtasks.exe', ['/Delete', '/TN', 'Napoleon HQ', '/F']); fs.rmSync(path.join(dataDir(), 'windows-task.xml'), { force: true }) }
    else throw new Error('No hay inicio automático gestionado en este sistema.')
    console.log('Inicio automático eliminado.'); return
  }
  if (action === 'serve') { await configureServe(config, tailState()); return }
  throw new Error('Comandos: setup, ensure-codex [--login], status, configure [--public-url URL] [--allow-sleep], serve, autostart [--dry-run], start, remove-autostart')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
