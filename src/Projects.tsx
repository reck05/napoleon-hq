import { useEffect, useRef, useState } from 'react'
import { post } from './api'
import type { Connection, PendingRequest, Project } from './types'

export function Projects({ connection, onClose, onSelected }: { connection: Connection | null; onClose: () => void; onSelected: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'local' | 'chatgpt'>('local')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/projects', { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('No se pudo cargar el catálogo')
      setProjects((await r.json()).projects)
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [])
  async function select(project: Project) {
    setBusy(project.id); setError('')
    try { await post('/api/project/select', { projectId: project.id }); onSelected() }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir el proyecto') }
    finally { setBusy(undefined) }
  }
  const visible = projects.filter(p => p.kind === kind && `${p.name} ${p.path ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <dialog ref={dialog} className="projects-dialog" onCancel={onClose} aria-labelledby="projects-title">
      <div className="projects-head"><div><span className="eyebrow">TU CUARTEL GENERAL</span><h2 id="projects-title">Elige el terreno.</h2></div><button className="txt" onClick={onClose} aria-label="Cerrar proyectos">×</button></div>
      <p className="projects-intro">Selecciona una carpeta y dale un objetivo a Napoleon. Codex ejecutará el trabajo con tus instrucciones de coordinación.</p>
      <div className="projects-tabs">
        <button className={`txt ${kind === 'local' ? 'is-on' : ''}`} onClick={() => setKind('local')}>En este Mac <span>{projects.filter(p => p.available).length}</span></button>
        <button className={`txt ${kind === 'chatgpt' ? 'is-on' : ''}`} onClick={() => setKind('chatgpt')}>ChatGPT <span>{projects.filter(p => p.kind === 'chatgpt').length}</span></button>
      </div>
      <input autoFocus className="project-search" aria-label="Buscar proyecto" placeholder="Buscar proyecto…" value={query} onChange={e => setQuery(e.target.value)} />
      {kind === 'chatgpt' && <p className="project-note">Enlaces a tus proyectos de ChatGPT. Sus conversaciones y archivos aún no están importados en Codex.</p>}
      {error && <p role="alert" className="c-error">{error}</p>}
      <ul className="project-list">
        {visible.map(p => <li key={p.id}>
          <div><strong>{p.name}</strong><span className="project-path">{p.path ?? 'Proyecto de ChatGPT'}</span></div>
          {p.kind === 'chatgpt' ? <a className="project-open" href={p.url ?? '#'} target="_blank" rel="noreferrer">abrir ↗</a> :
            <button className="project-open" disabled={!!busy || !p.available || !connection?.authenticated} onClick={() => void select(p)}>{busy === p.id ? 'abriendo…' : !p.available ? 'carpeta no encontrada' : connection?.activeProjectId === p.id ? 'continuar →' : 'trabajar aquí →'}</button>}
        </li>)}
      </ul>
      {visible.length === 0 && <p className="faint">{projects.length ? 'No hay proyectos con ese nombre.' : 'Cargando proyectos…'}</p>}
      <p className="project-note">Las carpetas locales se usan en su ubicación actual. Foco · misiones claras · autonomía · verificación.</p>
    </dialog>
  )
}

export function CampaignBar({ connection, onProjects, onConversation }: { connection: Connection | null; onProjects: () => void; onConversation: () => void }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  async function send() {
    if (!draft.trim() || sending) return
    setSending(true); setError('')
    try { await post('/api/send', { to: 'napoleon', text: draft.trim() }); setDraft(''); onConversation() }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo entregar la tarea') }
    finally { setSending(false) }
  }
  async function stop() {
    try { await post('/api/interrupt') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo detener la tarea') }
  }
  return <div className="campaign">
    <div className="campaign-context"><span className={`st ${connection?.connected && connection?.authenticated ? 'st-live' : 'st-off'}`}><i />{connection?.authenticated && connection?.connected ? 'Codex conectado' : 'conectando Codex'}</span><button className="txt is-on" onClick={onProjects}>{connection?.projectName ?? 'Seleccionar proyecto'} ↓</button><span className="faint">coordinador configurado</span></div>
    <form className="campaign-form" onSubmit={e => { e.preventDefault(); void send() }}>
      <input aria-label="Objetivo de la campaña" placeholder={connection?.activeProjectId ? '¿Qué quieres conseguir? Define el resultado y las restricciones…' : 'Selecciona un proyecto para empezar…'} value={draft} onChange={e => setDraft(e.target.value)} disabled={!connection?.activeProjectId || !connection?.connected || !connection?.authenticated} />
      <button className="campaign-send" disabled={sending || !draft.trim() || !connection?.activeProjectId}>{sending ? 'enviando…' : connection?.busy ? 'dar directriz →' : 'iniciar campaña →'}</button>
      {connection?.busy && <button type="button" className="txt" onClick={() => void stop()}>detener</button>}
    </form>
    {(error || connection?.error) && <p className="c-error" role="alert">{error || connection?.error}</p>}
  </div>
}

function RequestCard({ request }: { request: PendingRequest }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function respond(decision: string) {
    setBusy(true); setError('')
    try { await post('/api/respond', { id: request.id, decision, answers }) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo responder'); setBusy(false) }
  }
  return <section className="request-card" aria-label="Decisión solicitada por Codex">
    <strong>Codex necesita una decisión</strong>
    {request.params.questions?.map(q => <label key={q.id}>{q.question}
      {q.options && <div className="request-options">{q.options.map(o => <button type="button" className="txt" key={o.label} onClick={() => setAnswers(a => ({ ...a, [q.id]: o.label }))}>{o.label}</button>)}</div>}
      <input value={answers[q.id] ?? ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} />
    </label>)}
    {!request.params.questions && <><p>{request.params.reason ?? 'Autorizar esta acción en tu proyecto.'}</p><pre>{request.params.command ?? JSON.stringify(request.params.permissions ?? request.params, null, 2)}</pre></>}
    {error && <p className="c-error" role="alert">{error}</p>}
    <div className="request-actions"><button disabled={busy} onClick={() => void respond('accept')}>{request.params.questions ? 'enviar respuesta' : 'permitir una vez'}</button>{!request.params.questions && <button className="txt" disabled={busy} onClick={() => void respond('decline')}>rechazar</button>}</div>
  </section>
}

export function Requests({ connection }: { connection: Connection | null }) {
  if (!connection?.requests.length) return null
  return <aside className="requests" aria-live="polite">{connection.requests.map(r => <RequestCard key={r.id} request={r} />)}</aside>
}
