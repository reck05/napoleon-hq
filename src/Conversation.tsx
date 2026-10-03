import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { clockOf } from './util'
import type { Msg } from './types'

const token = () => document.querySelector<HTMLMetaElement>('meta[name="hq-token"]')?.content ?? ''

function Bubble({ m }: { m: Msg & { isAnswer?: boolean } }) {
  const [isOpen, setOpen] = useState(false)
  const isLong = m.text.length > 320 || m.text.split('\n').length > 6
  return (
    <motion.li className={`c-msg ${m.from === 'tú' ? 'is-you' : ''} ${m.isAnswer ? 'is-answer' : ''}`} layout initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
      <div className="c-meta">
        <span>{m.from}</span>
        <span className="faint">{clockOf(m.t)}{m.status ? ` · ${m.status}` : ''}</span>
      </div>
      <motion.div className={`c-text ${isLong && !isOpen ? 'is-clamped' : ''}`} layout>{m.text}</motion.div>
      {isLong && <button className="txt c-more" onClick={() => setOpen(v => !v)}>{isOpen ? 'menos' : 'ver todo'}</button>}
    </motion.li>
  )
}

/**
 * Everything said to one agent (its birth prompt, later messages, your orders) and its answer,
 * plus a box to send it a new order. Orders go to server.mjs, which the mod delivers.
 */
export function Conversation({ to, agentName, convo, answer, isLive, isDemo }: { to: string; agentName: string; convo: Msg[]; answer?: { t: number; text: string }; isLive: boolean; isDemo: boolean }) {
  const [draft, setDraft] = useState('')
  const [local, setLocal] = useState<Msg[]>([])
  const [error, setError] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  // a local echo disappears once the mod reports the same order back
  useEffect(() => {
    setLocal(l => l.filter(m => !convo.some(c => c.from === 'tú' && c.text === m.text)))
  }, [convo])
  useEffect(() => { setDraft(''); setLocal([]); setError('') }, [to])

  const send = async () => {
    const text = draft.trim()
    if (!text) { setError('Escribe una orden primero'); box.current?.focus(); return }
    setError('')
    if (isDemo) {
      setLocal(l => [...l, { t: Date.now(), from: 'tú', text, status: 'demo · no se envía' }])
      setDraft('')
      return
    }
    setLocal(l => [...l, { t: Date.now(), from: 'tú', text, status: 'enviando' }])
    setDraft('')
    try {
      const r = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hq-token': token() }, body: JSON.stringify({ to, text }) })
      if (!r.ok) throw new Error(r.status === 403 ? 'el servidor rechazó el token: recarga la página' : `error ${r.status}`)
      setLocal(l => l.map(m => (m.text === text && m.status === 'enviando' ? { ...m, status: 'en cola' } : m)))
    } catch (e) {
      setLocal(l => l.filter(m => m.text !== text))
      setDraft(text)
      setError(e instanceof Error ? e.message : 'no se pudo enviar')
    }
  }

  const all: (Msg & { isAnswer?: boolean })[] = [...convo, ...local]
  if (answer) all.push({ t: answer.t, from: agentName, text: answer.text, isAnswer: true })
  all.sort((a, b) => a.t - b.t)

  return (
    <section className="convo">
      <h3>conversación <span className="faint">{convo.length + local.length}</span></h3>
      {all.length === 0 && <p className="faint">Aún no hay mensajes registrados para este agente.</p>}
      <ul className="c-list">
        <AnimatePresence initial={false}>{all.map(m => <Bubble key={`${m.t}-${m.from}-${m.text.slice(0, 24)}`} m={m} />)}</AnimatePresence>
      </ul>
      <div className="c-compose">
        <textarea
          ref={box}
          rows={2}
          value={draft}
          placeholder={to === 'napoleon' ? 'Orden para Napoleon…' : isLive ? 'Escribe una orden para este agente…' : 'Ya terminó: tu orden lo retomará vía Napoleon…'}
          onChange={e => { setDraft(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
        />
        <div className="c-actions">
          {error ? <span className="c-error">{error}</span> : <span className="faint">Ctrl + Enter</span>}
          <button className="txt is-on" onClick={() => void send()}>enviar</button>
        </div>
      </div>
    </section>
  )
}
