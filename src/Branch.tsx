import { memo, useEffect, useRef } from 'react'
import type { Edge, EdgeProps } from '@xyflow/react'
import type { Pulse } from './types'

export type BranchT = Edge<{ dir: 'down' | 'right'; isLive: boolean; isFailed: boolean; isDimmed: boolean; pulses: Pulse[] }, 'branch'>

/** Family-tree connector: stem out of the parent, along the sibling bar, into the child. Soft corners. */
export function elbow(sx: number, sy: number, tx: number, ty: number, dir: 'down' | 'right' = 'down') {
  if (dir === 'right') {
    const mx = sx + (tx - sx) / 2
    const dy = ty - sy
    if (Math.abs(dy) < 0.5) return `M${sx},${sy} H${tx}`
    const r = Math.min(10, Math.abs(dy) / 2, (tx - sx) / 4)
    const s = Math.sign(dy)
    return `M${sx},${sy} H${mx - r} Q${mx},${sy} ${mx},${sy + s * r} V${ty - s * r} Q${mx},${ty} ${mx + r},${ty} H${tx}`
  }
  const my = sy + (ty - sy) / 2
  const dx = tx - sx
  if (Math.abs(dx) < 0.5) return `M${sx},${sy} V${ty}`
  const r = Math.min(10, Math.abs(dx) / 2, (ty - sy) / 4)
  const s = Math.sign(dx)
  return `M${sx},${sy} V${my - r} Q${sx},${my} ${sx + s * r},${my} H${tx - s * r} Q${tx},${my} ${tx},${my + r} V${ty}`
}

// a dot of light along the branch; SMIL started once on mount so it always runs from its start
function Spark({ d, p }: { d: string; p: Pulse }) {
  const g = useRef<SVGGElement>(null)
  useEffect(() => { g.current?.querySelectorAll<SVGAnimationElement>('animate, animateMotion').forEach(el => el.beginElement()) }, [])
  const isUp = p.kind !== 'call'
  const dur = `${p.kind === 'call' ? 0.8 : 1.2}s`
  return (
    <g ref={g} opacity={0}>
      <animate attributeName="opacity" begin="indefinite" dur={dur} values="0;1;1;0" keyTimes="0;0.15;0.8;1" fill="freeze" />
      <circle r={p.kind === 'call' ? 1.6 : 2.6} fill={p.color}>
        <animateMotion begin="indefinite" dur={dur} path={d} keyPoints={isUp ? '1;0' : '0;1'} keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.2 1" fill="freeze" />
      </circle>
    </g>
  )
}

export const Branch = memo(function Branch({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<BranchT>) {
  if (!data) return null
  const d = elbow(sourceX, sourceY, targetX, targetY, data.dir)
  return (
    <g className={`b ${data.isLive ? 'b-live' : ''} ${data.isFailed ? 'b-fail' : ''}`} opacity={data.isDimmed ? 0.12 : 1}>
      <path d={d} className="b-line" />
      {data.isLive && <path d={d} className="b-flow" />}
      {data.pulses.map(p => <Spark key={p.id} d={d} p={p} />)}
    </g>
  )
})
