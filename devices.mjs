import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { protect } from './secure.mjs'

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
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (!saved.id || !Array.isArray(saved.devices)) throw new Error('El registro de computadoras no es válido')
      this.data = saved
    }
    this.save()
  }
  save() {
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
  selected() { return this.data.devices.find(device => device.id === this.data.selectedId) ?? null }
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
      const info = await response.json()
      if (info.id !== device.id) throw new Error('Esta dirección pertenece a otra computadora; vuelve a emparejarla')
      return { online: true, engine: info.engine, error: '' }
    } catch (error) { return { online: false, engine: device.engine, error: error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Computadora sin conexión. Enciéndela o activa el despertar automático.' : error.message } }
  }
  async list() {
    const devices = await Promise.all(this.data.devices.map(async ({ token, ...device }) => ({ ...device, isLocal: false, ...(await this.probe({ ...device, token })) })))
    return { selectedId: this.data.selectedId, devices: [{ id: 'local', label: this.label, url: this.url, isLocal: true, online: true, engine: this.engine, error: '' }, ...devices], pairing: { keyFile: this.keyFile } }
  }
  async pair({ url: input, token, label }) {
    const url = deviceUrl(input)
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token.trim())) throw new Error('Copia la clave completa de 64 caracteres de la otra computadora')
    const candidate = { url, token: token.trim() }
    let response
    try { response = await this.request(candidate, '/api/device/info', { signal: AbortSignal.timeout(5000) }) }
    catch { throw new Error('No se puede conectar con esa computadora. Comprueba que Napoleon y la red privada están activos.') }
    if (!response.ok) throw new Error(response.status === 403 ? 'La clave de la otra computadora no es correcta' : 'La otra computadora no admite el emparejamiento')
    const info = await response.json()
    if (!info.id || typeof info.id !== 'string' || !['codex', 'claude'].includes(info.engine)) throw new Error('La respuesta de la otra computadora no es válida')
    if (info.id === this.data.id) throw new Error('Esta es la misma computadora; selecciona el equipo local')
    const device = { ...candidate, id: info.id, engine: info.engine, label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : String(info.label || 'Otra computadora').slice(0, 80) }
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
