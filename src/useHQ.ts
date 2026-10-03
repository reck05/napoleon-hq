import { useEffect, useRef, useState } from 'react'
import { demoState } from './demo'
import { NAPOLEON, type HQState, type Pulse } from './types'

export type Mode = 'live' | 'demo'
export type Link = 'connecting' | 'live' | 'offline'

/** The HQ state: streamed from the mod over SSE, or the scripted demo. */
export function useHQ(mode: Mode) {
  const [state, setState] = useState<HQState | null>(null)
  const [link, setLink] = useState<Link>('connecting')

  useEffect(() => {
    setState(null)
    if (mode === 'demo') {
      const t0 = Date.now()
      const id = setInterval(() => setState(demoState(t0, Date.now())), 120)
      return () => clearInterval(id)
    }
    setLink('connecting')
    const es = new EventSource('/api/events')
    es.addEventListener('state', ev => {
      try {
        setState(JSON.parse((ev as MessageEvent).data))
        setLink('live')
      } catch { /* a torn frame; the next one is whole */ }
    })
    es.onopen = () => setLink('live')
    es.onerror = () => setLink('offline')
    return () => es.close()
  }, [mode])

  return { state, link }
}

/** Diffs consecutive states into pulses that travel the branches: down for each tool call, up when a report comes home. */
export function usePulses(state: HQState | null) {
  const prev = useRef<HQState | null>(null)
  const [pulses, setPulses] = useState<Pulse[]>([])

  useEffect(() => {
    const before = prev.current
    prev.current = state
    if (!state || !before) return
    const old = new Map(before.agents.map(a => [a.id, a]))
    const ids = new Set(state.agents.map(a => a.id))
    const now = Date.now()
    const out: Pulse[] = []
    for (const a of state.agents) {
      const edge = `e-${a.parentId && ids.has(a.parentId) ? a.parentId : NAPOLEON}-${a.id}`
      const was = old.get(a.id)
      if (!was) continue
      if (a.log.length > was.log.length) out.push({ id: `${a.id}-c${a.log.length}`, edge, kind: 'call', color: '#ffffff', at: now })
      if (was.status === 'running' && a.status !== 'running') out.push({ id: `${a.id}-end`, edge, kind: a.status === 'completed' ? 'report' : 'fail', color: a.status === 'completed' ? '#ffffff' : '#ff5a52', at: now })
    }
    if (out.length) setPulses(p => [...p.filter(x => now - x.at < 1800), ...out].slice(-200))
  }, [state])

  useEffect(() => {
    const id = setInterval(() => setPulses(p => (p.some(x => Date.now() - x.at > 1800) ? p.filter(x => Date.now() - x.at < 1800) : p)), 1000)
    return () => clearInterval(id)
  }, [])

  return pulses
}
