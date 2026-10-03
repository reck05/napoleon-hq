import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { motion } from 'motion/react'
import { areaOf } from './areas'
import { fmtDur, useNow } from './util'
import type { Agent, HQState } from './types'

export type AgentNodeT = Node<{ agent: Agent; isSelected: boolean; isDimmed: boolean }, 'agent'>
export type NapoleonNodeT = Node<{ napoleon: HQState['napoleon']; live: number; total: number; isSelected: boolean; isDimmed: boolean }, 'napoleon'>

// both orientations' ports; edges pick t/b (down) or l/r (right)
const handles = (
  <>
    <Handle id="t" type="target" position={Position.Top} className="h" isConnectable={false} />
    <Handle id="b" type="source" position={Position.Bottom} className="h" isConnectable={false} />
    <Handle id="l" type="target" position={Position.Left} className="h" isConnectable={false} />
    <Handle id="r" type="source" position={Position.Right} className="h" isConnectable={false} />
  </>
)

// text that morphs (blur → sharp) whenever its value changes
function Morph({ text, className }: { text: string; className?: string }) {
  return (
    <motion.span key={text} className={className} initial={{ opacity: 0, filter: 'blur(4px)', y: 3 }} animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
      {text}
    </motion.span>
  )
}

export const AgentNode = memo(function AgentNode({ data }: NodeProps<AgentNodeT>) {
  const { agent: a, isSelected, isDimmed } = data
  const now = useNow(1000)
  const state = a.status === 'running' ? 'live' : a.status === 'completed' ? 'done' : 'fail'
  const sub = state === 'live' ? a.tool ?? 'arrancando' : state === 'done' ? 'hecho' : 'falló'
  return (
    <motion.div
      className={`n n-${state} ${isSelected ? 'is-sel' : ''}`}
      style={{ ['--c' as string]: areaOf(a.areaKey).color }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: isDimmed ? 0.14 : 1, scale: 1 }}
      transition={{ opacity: { duration: 0.5 }, scale: { type: 'spring', stiffness: 180, damping: 20 } }}
    >
      {handles}
      <div className="n-row">
        <i className="n-dot" />
        <span className="n-name">{a.description}</span>
      </div>
      <div className="n-row n-meta">
        <Morph text={sub} className="n-tool" />
        <span className="n-time">{fmtDur((a.endedAt ?? now) - a.startedAt)}</span>
      </div>
      {state === 'live' && <i className="n-scan" />}
    </motion.div>
  )
})

export const NapoleonNode = memo(function NapoleonNode({ data }: NodeProps<NapoleonNodeT>) {
  const { napoleon: n, live, total, isSelected, isDimmed } = data
  const doing = n.tool === 'Agent' ? 'delegando' : n.tool ?? (live ? `${live} en campo` : total ? 'en reposo' : 'esperando órdenes')
  return (
    <motion.div className={`n n-root ${isSelected ? 'is-sel' : ''}`} animate={{ opacity: isDimmed ? 0.3 : 1 }}>
      {handles}
      <div className="n-row">
        <span className="n-name">Napoleon</span>
        <span className="n-time">{total || ''}</span>
      </div>
      <div className="n-row n-meta">
        <Morph text={doing} className="n-tool" />
      </div>
      {(live > 0 || n.tool) && <i className="n-scan" />}
    </motion.div>
  )
})
