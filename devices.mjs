import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { protect } from './secure.mjs'
import { readRemoteJSON } from './remote-response.mjs'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const validId = value => typeof value === 'string' && UUID_V4.test(value)
const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const validInfo = info => info && typeof info === 'object' && !Array.isArray(info) && validId(info.id) && ['codex', 'claude'].includes(info.engine)

function validateRegistry(saved) {
  const invalid = () => { throw new Error('El registro de computadoras no es válido. Revisa devices.json antes de enviar tareas; no se ha cambiado el destino.') }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !validId(saved.id) || !Array.isArray(saved.devices)) invalid()
  const ids = new Set()
  const urls = new Set()
  const devices = saved.devices.map(device => {
    if (!device || typeof device !== 'object' || Array.isArray(device) || !validId(device.id) || device.id === saved.id || ids.has(device.id) || !validToken(device.token) || !['codex', 'claude'].includes(device.engine) || typeof device.label !== 'string' || !device.label.trim() || device.label.length > 80 || typeof device.url !== 'string') invalid()
    let url
    try { url = deviceUrl(device.url) } catch { invalid() }
    if (url !== device.url || urls.has(url)) invalid()
    ids.add(device.id); urls.add(url)
    return { id: device.id, url, token: device.token, engine: device.engine, label: device.label }
  })
  if (saved.selectedId !== 'local' && (!validId(saved.selectedId) || !ids.has(saved.selectedId))) invalid()
  return { id: saved.id, selectedId: saved.selectedId, devices }
}

export function deviceUrl(input) {
  let url
  try { url = new URL(input) } catch { throw new Error('Introduce una dirección HTTPS válida para la otra computadora') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Usa HTTPS privado o HTTP en localhost, sin contraseña ni rutas en la dirección')
  }
  return url.origin
}

export class DeviceManager {
  constructor({ dir, engine, port }) {
    this.file = path.join(dir, 'devices.json')
    this.keyFile = path.join(dir, 'device.key')
    if (!fs.existsSync(this.keyFile)) fs.writeFileSync(this.keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
    protect(this.keyFile)
    this.key = fs.readFileSync(this.keyFile, 'utf8').trim()
    if (!/^[a-f0-9]{64}$/.test(this.key)) throw new Error('La clave de esta computadora no es válida')
    this.engine = engine
    this.url = `http://localhost:${port}`
    this.label = os.hostname().replace(/\.local$/, '')
    this.data = { id: crypto.randomUUID(), selectedId: 'local', devices: [] }
    if (fs.existsSync(this.file)) {
      this.data = validateRegistry(JSON.parse(fs.readFileSync(this.file, 'utf8')))
    }
    this.save()
  }
  save() {
    this.data = validateRegistry(this.data)
    const temporary = this.file + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    protect(temporary)
    fs.renameSync(temporary, this.file)
  }
  authenticated(req) {
    const supplied = req.headers['x-device-key']
    if (typeof supplied !== 'string') return false
    const actual = Buffer.from(supplied)
    const expected = Buffer.from(this.key)
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  }
  info() { return { id: this.data.id, label: this.label, engine: this.engine } }
  selected() {
    if (this.data.selectedId === 'local') return null
    const device = this.data.devices.find(device => device.id === this.data.selectedId)
    if (!validId(this.data.selectedId) || !device) throw new Error('La computadora seleccionada no está registrada. Revisa el destino antes de enviar tareas.')
    return device
  }
  async request(device, route, { method = 'GET', body, signal } = {}) {
    return fetch(device.url + route, {
      method, body, signal: signal ?? AbortSignal.timeout(10000), redirect: 'error',
      headers: { 'x-device-key': device.token, 'content-type': 'application/json' },
    })
  }
  async probe(device) {
    try {
      const response = await this.request(device, '/api/device/info', { signal: AbortSignal.timeout(2500) })
      if (!response.ok) throw new Error(response.status === 403 ? 'La clave de emparejamiento fue rechazada' : `Error ${response.status}`)
      const info = await readRemoteJSON(response)
      if (!validInfo(info) || info.id !== device.id || info.id === this.data.id) throw new Error('Esta dirección pertenece a otra computadora; vuelve a emparejarla')
      return { online: true, engine: info.engine, error: '' }
    } catch (error) { return { online: false, engine: device.engine, error: error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Computadora sin conexión. Enciéndela o activa el despertar automático.' : error.message } }
  }
  async list() {
    const devices = await Promise.all(this.data.devices.map(async ({ token, ...device }) => ({ ...device, isLocal: false, ...(await this.probe({ ...device, token })) })))
    return { selectedId: this.data.selectedId, devices: [{ id: 'local', label: this.label, url: this.url, isLocal: true, online: true, engine: this.engine, error: '' }, ...devices], pairing: { keyFile: this.keyFile } }
  }
  async pair({ url: input, token, label }) {
    const url = deviceUrl(input)
    if (typeof token !== 'string' || !validToken(token.trim())) throw new Error('Copia la clave completa de 64 caracteres de la otra computadora')
    const candidate = { url, token: token.trim() }
    let response
    try { response = await this.request(candidate, '/api/device/info', { signal: AbortSignal.timeout(5000) }) }
    catch { throw new Error('No se puede conectar con esa computadora. Comprueba que Napoleon y la red privada están activos.') }
    if (!response.ok) throw new Error(response.status === 403 ? 'La clave de la otra computadora no es correcta' : 'La otra computadora no admite el emparejamiento')
    const info = await readRemoteJSON(response)
    if (!validInfo(info)) throw new Error('La identidad de la otra computadora no es válida')
    if (info.id === this.data.id) throw new Error('Esta es la misma computadora; selecciona el equipo local')
    if (this.data.devices.some(device => device.url === url && device.id !== info.id)) throw new Error('La identidad de esta dirección ha cambiado. Desconecta el registro anterior y verifica la otra computadora antes de volver a emparejarla.')
    const remoteLabel = typeof info.label === 'string' ? info.label.trim() : ''
    const device = { ...candidate, id: info.id, engine: info.engine, label: (typeof label === 'string' && label.trim() ? label.trim() : remoteLabel || 'Otra computadora').slice(0, 80) }
    this.data.devices = [...this.data.devices.filter(existing => existing.id !== device.id), device]
    this.save()
    const { token: hidden, ...publicDevice } = device
    return { ok: true, device: { ...publicDevice, isLocal: false, online: true, error: '' } }
  }
  select(id) {
    if (id !== 'local' && !this.data.devices.some(device => device.id === id)) throw new Error('Computadora no encontrada')
    this.data.selectedId = id
    this.save()
    return { ok: true, selectedId: id }
  }
  remove(id) {
    if (id === 'local') throw new Error('No puedes eliminar esta computadora')
    this.data.devices = this.data.devices.filter(device => device.id !== id)
    if (this.data.selectedId === id) this.data.selectedId = 'local'
    this.save()
    return { ok: true, selectedId: this.data.selectedId }
  }
}
