import { useEffect, useRef, useState } from 'react'
import { areaOf } from './areas'
import { clockOf, useNow } from './util'
import { NAPOLEON, type HQState } from './types'

const LABEL = 190
const ROW = 15

/** One hairline per agent across its life; a tick per tool call; a moving "now". */
export function Timeline({ state, selected, onSelect }: { state: HQState; selected?: string; onSelect: (id: string) => void }) {
  const now = useNow(250)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  const rows = [
    { id: NAPOLEON, label: 'Napoleon', color: '#fff', start: state.sessionStart, end: now, live: true, fail: false, ticks: state.napoleon.log },
    ...[...state.agents].sort((a, b) => a.startedAt - b.startedAt).map(a => ({
      id: a.id, label: a.description, color: areaOf(a.areaKey).color, start: a.startedAt, end: a.endedAt ?? now,
      live: a.status === 'running', fail: a.status === 'failed' || a.status === 'killed', ticks: a.log,
    })),
  ]
  const t0 = Math.min(...rows.map(r => r.start))
  const span = Math.max(30_000, now - t0) * 1.03
  const plot = Math.max(100, w - LABEL - 12)
  const x = (t: number) => LABEL + ((t - t0) / span) * plot
  const h = rows.length * ROW + 18
  const step = [5, 10, 15, 30, 60, 120, 300, 600, 1800].map(s => s * 1000).find(s => (s / span) * plot > 80) ?? 3_600_000

  return (
    <div className="tl" ref={box}>
      <svg width={w} height={h} onMouseLeave={() => setTip(null)}>
        {Array.from({ length: Math.ceil(span / step) + 1 }, (_, i) => t0 + i * step).map(t => (
          <text key={t} x={x(t)} y={9} className="tl-axis">{clockOf(t).slice(0, 8)}</text>
        ))}
        {rows.map((r, i) => {
          const y = 18 + i * ROW + ROW / 2
          const isSel = r.id === selected
          return (
            <g key={r.id} className={`tl-row ${isSel ? 'is-sel' : ''} ${r.live ? 'is-live' : ''}`} onClick={() => onSelect(r.id)}>
              <rect x={0} y={y - ROW / 2} width={w} height={ROW} className="tl-hit" />
              <circle cx={8} cy={y} r={2.2} fill={r.fail ? '#ff5a52' : r.color} opacity={r.live ? 1 : 0.45} />
              <text x={18} y={y + 3.5} className="tl-label">{r.label.length > 27 ? r.label.slice(0, 26) + '…' : r.label}</text>
              <line x1={x(r.start)} x2={x(r.end)} y1={y} y2={y} className={`tl-life ${r.fail ? 'is-fail' : ''}`} />
              {r.ticks.map(l => (
                <line key={`${l.t}-${l.tool}`} x1={x(l.t)} x2={x(l.t)} y1={y - 3} y2={y + 3} className={`tl-tick ${now - l.t < 1200 ? 'is-new' : ''}`}
                  onMouseEnter={() => setTip({ x: x(l.t), y, text: `${clockOf(l.t)}  ${l.tool}${l.detail ? '  ' + l.detail : ''}` })} />
              ))}
            </g>
          )
        })}
        <line x1={x(now)} x2={x(now)} y1={12} y2={h} className="tl-now" />
      </svg>
      {tip && <div className="tl-tip" style={{ left: Math.min(tip.x + 10, w - 340), top: tip.y + 8 }}>{tip.text}</div>}
    </div>
  )
}
