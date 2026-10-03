import { useEffect, useRef, useState } from 'react'
import { post } from './api'

type Device = { id: string; label: string; url: string; isLocal: boolean; online: boolean; engine?: string; error?: string }
export type DeviceCatalog = { selectedId: string; devices: Device[] }
type MobileAccess = { url: string | null; configured: boolean; status?: { phase: string; message: string; actionUrl?: string } }
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

function tailscaleActionUrl(value?: string) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'login.tailscale.com' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function useInstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches)
  useEffect(() => {
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt) }
    const done = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', ready)
    window.addEventListener('appinstalled', done)
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', done) }
  }, [])
  async function install() {
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice
    setPrompt(null)
  }
  return { available: !!prompt, installed, install }
}

export function Devices({ onClose, onSelected, installation }: { onClose: () => void; onSelected: () => void; installation: ReturnType<typeof useInstallApp> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<'computers' | 'phone'>('computers')
  const [catalog, setCatalog] = useState<DeviceCatalog | null>(null)
  const [mobile, setMobile] = useState<MobileAccess | null>(null)
  const [error, setError] = useState('')
  const [needsLogin, setNeedsLogin] = useState(false)
  const [busy, setBusy] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [label, setLabel] = useState('')
  const [pairing, setPairing] = useState<{ token: string; label: string } | null>(null)
  const [phoneLink, setPhoneLink] = useState('')
  const [phoneQr, setPhoneQr] = useState('')
  const [copied, setCopied] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/devices', { signal: controller.signal }).then(async r => {
      if (r.status === 401) setNeedsLogin(true)
      if (!r.ok) throw new Error('No se pudieron cargar las computadoras.')
      setCatalog(await r.json())
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    void fetch('/api/mobile', { signal: controller.signal }).then(async r => {
      if (r.ok) setMobile(await r.json())
    }).catch(() => { /* The computer list remains usable while mobile access is unavailable. */ })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (tab !== 'phone') return
    const controller = new AbortController()
    const refreshMobile = () => {
      void fetch('/api/mobile', { signal: controller.signal }).then(async r => {
        if (r.status === 401) setNeedsLogin(true)
        if (r.ok) setMobile(await r.json())
      }).catch(() => { /* Retry on the next interval after a server restart. */ })
    }
    refreshMobile()
    const timer = setInterval(refreshMobile, 10000)
    return () => { clearInterval(timer); controller.abort() }
  }, [tab])
  async function action(key: string, run: () => Promise<void>) {
    setBusy(key); setError('')
    try { await run() }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la acción.') }
    finally { setBusy('') }
  }
  async function refresh() {
    const response = await fetch('/api/devices')
    if (!response.ok) throw new Error('No se pudieron actualizar las computadoras.')
    setCatalog(await response.json())
  }
  async function copy(text: string, key: string) {
    await action(`copy-${key}`, async () => {
      await navigator.clipboard.writeText(text)
      setCopied(key)
    })
  }
  const mobileReady = !!mobile?.configured && (!mobile.status || mobile.status.phase === 'ready')
  const setupAction = tailscaleActionUrl(mobile?.status?.actionUrl)
  return <dialog ref={dialog} className="projects-dialog devices-dialog" onCancel={onClose} aria-labelledby="devices-title">
    <div className="projects-head"><div><span className="eyebrow">NAPOLEON CONTIGO</span><h2 id="devices-title">Tus computadoras.</h2></div><button className="txt" onClick={onClose} aria-label="Cerrar computadoras">×</button></div>
    <div className="projects-tabs">
      <button className={`txt ${tab === 'computers' ? 'is-on' : ''}`} onClick={() => setTab('computers')}>Computadoras</button>
      <button className={`txt ${tab === 'phone' ? 'is-on' : ''}`} onClick={() => setTab('phone')}>Mi teléfono</button>
    </div>
    {error && <p className="c-error" role="alert">{error}</p>}
    {needsLogin && <p><a className="project-open" href="/">Volver a conectar con Napoleon →</a></p>}
    {tab === 'computers' ? <>
      <p className="projects-intro">Elige dónde trabajará Codex. Desde el teléfono puedes cambiar de computadora y ver sus proyectos, tareas y resultados.</p>
      <ul className="device-list">
        {catalog?.devices.map(device => <li key={device.id}>
          <div className="device-info"><strong>{device.label}</strong><span className={`device-status ${device.online ? 'is-online' : ''}`}><i className="dot" />{device.online ? 'En línea' : 'No disponible'}{catalog.selectedId === device.id ? ' · seleccionada' : ''}</span><span className="project-path">{device.isLocal ? 'Esta computadora' : device.url}</span>{!device.online && device.error && <span className="project-note">Comprueba que tiene conexión y Napoleon está abierto.</span>}</div>
          <div className="device-actions"><button className="project-open" disabled={!!busy || !device.online || catalog.selectedId === device.id} onClick={() => void action(device.id, async () => { await post('/api/devices/select', { id: device.id }); onSelected() })}>{catalog.selectedId === device.id ? 'En uso' : busy === device.id ? 'conectando…' : 'Usar esta →'}</button>{!device.isLocal && <button className="txt" disabled={!!busy} onClick={() => void action(`remove-${device.id}`, async () => { await post('/api/devices/remove', { id: device.id }); if (catalog.selectedId === device.id) onSelected(); else await refresh() })}>Desconectar</button>}</div>
        </li>)}
      </ul>
      {!catalog && !error && <p className="faint">Buscando tus computadoras…</p>}
      <details className="device-section"><summary>Conectar mi segunda computadora</summary>
        <p className="project-note">Abre Napoleon en la segunda computadora. En «Computadoras», pulsa «Mostrar código de esta computadora». Copia su dirección privada y su código aquí.</p>
        <form className="device-form" onSubmit={e => { e.preventDefault(); void action('pair', async () => { await post('/api/devices/pair', { url: url.trim(), token: token.trim(), label: label.trim() }); setToken(''); setUrl(''); setLabel(''); await refresh() }) }}>
          <label>Nombre<input value={label} onChange={e => setLabel(e.target.value)} placeholder="Por ejemplo: computadora de casa" maxLength={100} /></label>
          <label>Dirección de Napoleon<input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://tu-computadora…ts.net" autoCapitalize="none" autoCorrect="off" /></label>
          <label>Código de la segunda computadora<input required type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" /></label>
          <button className="campaign-send" disabled={!!busy}>{busy === 'pair' ? 'Conectando…' : 'Conectar computadora'}</button>
        </form>
      </details>
      <details className="device-section"><summary>Mostrar código de esta computadora</summary>
        <p className="project-note">Úsalo solo para conectar tus propias computadoras. Quien tenga este código puede acceder a Napoleon.</p>
        {pairing ? <div className="pairing-details"><strong>{pairing.label}</strong><code>{pairing.token}</code><button className="txt is-on" disabled={!!busy} onClick={() => void copy(pairing.token, 'pairing')}>{copied === 'pairing' ? 'Código copiado' : 'Copiar código'}</button>{mobile?.url && <><span className="project-path">{mobile.url}</span><button className="txt is-on" disabled={!!busy} onClick={() => void copy(mobile.url!, 'address')}>{copied === 'address' ? 'Dirección copiada' : 'Copiar dirección privada'}</button></>}</div> : <button className="device-secondary" disabled={!!busy} onClick={() => void action('pairing', async () => setPairing(await post('/api/devices/pairing')))}>Mostrar mi código</button>}
      </details>
      <p className="project-note device-power-note">Napoleon necesita una computadora encendida para trabajar. El arranque automático mantiene el servicio disponible al iniciar el equipo; una computadora apagada no podrá ejecutar tareas.</p>
    </> : <>
      <p className="projects-intro">Lleva este panel en la pantalla de inicio y da instrucciones a Codex desde donde estés.</p>
      {mobile?.status?.message && <div className={`mobile-setup-status ${mobileReady ? 'is-ready' : ''}`} role="status"><p>{mobile.status.message}</p>{setupAction && !mobileReady && <a className="campaign-send" href={setupAction} target="_blank" rel="noreferrer">{mobile.status.phase === 'https' ? 'Activar acceso privado' : 'Conectar Tailscale'} ↗</a>}{setupAction && !mobileReady && <p className="project-note">Completa ese paso en la ventana que se abre. Napoleon continuará la preparación automáticamente.</p>}</div>}
      <ol className="phone-steps"><li><strong>Conecta tu teléfono a Tailscale.</strong><p>Instala la aplicación Tailscale y entra con la misma cuenta que usas en tus computadoras. Activa la conexión.</p><div className="phone-stores"><a href="https://apps.apple.com/app/tailscale/id1470499037" target="_blank" rel="noreferrer">iPhone ↗</a><a href="https://play.google.com/store/apps/details?id=com.tailscale.ipn" target="_blank" rel="noreferrer">Android ↗</a></div></li><li><strong>Abre tu enlace privado en el teléfono.</strong><p>{mobileReady ? 'Crea el enlace y ábrelo con Safari o Chrome en tu teléfono.' : 'La conexión privada de esta computadora todavía se está preparando. El enlace aparecerá cuando Tailscale esté conectado.'}</p>
        <p className="project-note">Usa el enlace o el código QR que creas aquí: incluyen tu acceso. La dirección de Napoleon por sí sola te pedirá un código.</p>
        <button className="campaign-send" disabled={!!busy || !mobileReady} onClick={() => void action('phone', async () => { const result = await post<{ url: string }>('/api/mobile/link'); setPhoneLink(result.url); const qr = await import('qrcode'); setPhoneQr(await qr.toDataURL(result.url, { width: 256, margin: 3 })) })}>{busy === 'phone' ? 'Creando enlace…' : 'Crear enlace para mi teléfono'}</button>
        {phoneLink && <div className="phone-link">{phoneQr && <img className="phone-qr" src={phoneQr} width="256" height="256" alt="Escanea este código con la cámara de tu teléfono para abrir Napoleon" />}<p className="project-note">Escanea el código con la cámara de tu teléfono.</p><a href={phoneLink} target="_blank" rel="noreferrer">Abrir Napoleon ↗</a><button className="device-secondary" disabled={!!busy} onClick={() => void copy(phoneLink, 'phone')}>{copied === 'phone' ? 'Enlace copiado' : 'Copiar enlace'}</button><p className="project-note">Este enlace es tu acceso privado. Compártelo solo contigo mismo.</p></div>}
      </li><li><strong>Añádelo a la pantalla de inicio.</strong><p>En iPhone: Safari → Compartir → Añadir a pantalla de inicio. En Android: Chrome → menú ⋮ → Añadir a pantalla de inicio o Instalar aplicación.</p>{installation.available && <button className="device-secondary" onClick={() => void action('install', installation.install)}>Instalar Napoleon</button>}{installation.installed && <p className="device-status is-online">Napoleon ya está abierto como aplicación.</p>}</li></ol>
      <p className="project-note">Si el panel pierde la conexión, las tareas siguen en la computadora. Vuelve a abrir Napoleon para ver sus resultados.</p>
    </>}
  </dialog>
}
