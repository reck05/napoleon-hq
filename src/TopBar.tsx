import { useEffect } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { fmtDur, fmtTokens, useNow } from './util'
import type { HQState } from './types'
import type { Link, Mode } from './useHQ'

// numbers roll to their new value instead of jumping
function Count({ value, format = (n: number) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, format)
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] })
    return () => c.stop()
  }, [mv, value])
  return <motion.b>{text}</motion.b>
}

type Props = { state: HQState | null; mode: Mode; link: Link; isTimelineOn: boolean; onMode: () => void; onTimeline: () => void; onPalette: () => void; onProjects: () => void; onDevices: () => void; deviceName?: string; projectsEnabled?: boolean }

export function TopBar(p: Props) {
  const now = useNow(1000)
  const agents = p.state?.agents ?? []
  const live = agents.filter(a => a.status === 'running').length
  const calls = (p.state?.napoleon.calls ?? 0) + agents.reduce((n, a) => n + a.calls, 0)
  const tokens = [p.state?.napoleon.usage, ...agents.map(a => a.usage)].reduce((n, u) => n + (u ? u.input + u.output : 0), 0)
  const status = p.mode === 'demo' ? ['demo', 'demo'] : p.link === 'live' ? ['live', 'en vivo'] : p.link === 'connecting' ? ['wait', 'conectando'] : ['off', 'sin conexión']

  return (
    <header className="top">
      <div className="top-l">
        <span className="mark">Napoleon</span>
        <span className={`st st-${status[0]}`}><i />{status[1]}</span>
      </div>
      <div className="top-c">
        <span><Count value={live} /> activos</span>
        <span><Count value={agents.length} /> agentes</span>
        <span><Count value={calls} /> llamadas</span>
        <span><Count value={tokens} format={fmtTokens} /> tokens</span>
        <span><b>{p.state?.sessionStart ? fmtDur(now - p.state.sessionStart) : '—'}</b></span>
      </div>
      <div className="top-r">
        <button className="txt is-on device-switch" onClick={p.onDevices} title={p.deviceName ? `Trabajando en ${p.deviceName}` : 'Elige dónde trabaja Codex'}>Computadoras{p.deviceName && <span>{p.deviceName}</span>}</button>
        {p.projectsEnabled && <button className="txt is-on" onClick={p.onProjects}>proyectos</button>}
        <button className={`txt ${p.isTimelineOn ? 'is-on' : ''}`} onClick={p.onTimeline}>tiempo</button>
        <button className={`txt ${p.mode === 'demo' ? 'is-on' : ''}`} onClick={p.onMode}>demo</button>
        <button className="txt" onClick={p.onPalette}>⌘K</button>
      </div>
    </header>
  )
}
