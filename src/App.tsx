import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeChange, type Viewport } from '@xyflow/react'
import { AnimatePresence, motion } from 'motion/react'
import { AREAS } from './areas'
import { Branch, type BranchT } from './Branch'
import { Inspector } from './Inspector'
import { bestDir, bounds, lineage, NODE, parentOf, useFamilyTree, type Dir, type XY } from './layout'
import { AgentNode, NapoleonNode, type AgentNodeT, type NapoleonNodeT } from './nodes'
import { Palette } from './Palette'
import { Timeline } from './Timeline'
import { TopBar } from './TopBar'
import { useHQ, usePulses, type Mode } from './useHQ'
import { store } from './util'
import { NAPOLEON, type HQState } from './types'

const nodeTypes = { agent: AgentNode, napoleon: NapoleonNode }
const edgeTypes = { branch: Branch }
const EMPTY: HQState = { v: 1, updatedAt: 0, sessionStart: Date.now(), napoleon: { calls: 0, log: [], voice: '' }, agents: [] }
const CAP = 120 // ponytail: oldest finished agents drop off past this; paginate the tree if campaigns get bigger

type GraphProps = {
  state: HQState
  selected?: string
  filter?: string
  onSelect: (id?: string) => void
  fitRef: React.RefObject<() => void>
  focusRef: React.RefObject<(id: string) => void>
}

function Graph({ state, selected, filter, onSelect, fitRef, focusRef }: GraphProps) {
  const flow = useReactFlow()
  const [isFollowing, setFollowing] = useState(true)
  const [hover, setHover] = useState<string>()
  const moveFrom = useRef<Viewport | null>(null)
  const pulses = usePulses(state)
  const agents = useMemo(() => {
    const done = state.agents.filter(a => a.status !== 'running')
    const drop = new Set(done.slice(0, Math.max(0, state.agents.length - CAP)).map(a => a.id))
    return state.agents.filter(a => !drop.has(a.id))
  }, [state.agents])
  // the tree turns (top-down ⇄ left-right) to whichever orientation shows it largest
  const canvas = useRef<HTMLDivElement>(null)
  const [dir, setDir] = useState<Dir>('down')
  const shapeKey = agents.map(a => a.id).join('|')
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const pick = () => setDir(d => bestDir(agents, el.clientWidth, el.clientHeight, d))
    pick()
    const ro = new ResizeObserver(pick)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey])
  const { pos, target } = useFamilyTree(agents, dir)

  // controlled nodes are rebuilt every frame: keep the sizes React Flow measures and hand them back
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({})
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const next: Record<string, { width: number; height: number }> = {}
    for (const c of changes) if (c.type === 'dimensions' && c.dimensions) next[c.id] = c.dimensions
    if (Object.keys(next).length) setDims(d => ({ ...d, ...next }))
  }, [])

  // frame the layout's destination, not the nodes still gliding toward it
  // frame the layout's destination; never closer than 1.1x so a small tree stays calm
  const frame = useCallback((m: Map<string, XY>, duration = 1100) => {
    const b = bounds(m)
    const el = canvas.current
    if (!Number.isFinite(b.x) || !el) return
    const zoom = Math.min(1.1, (el.clientWidth / b.width) * 0.88, (el.clientHeight / b.height) * 0.88)
    void flow.setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom, duration })
  }, [flow])

  fitRef.current = () => { setFollowing(true); frame(target) }
  focusRef.current = (id: string) => {
    const p = target.get(id)
    if (!p) return
    setFollowing(false)
    void flow.setCenter(p.x + NODE.w / 2, p.y + NODE.h / 2, { zoom: 1.25, duration: 900 })
  }

  useEffect(() => {
    if (!isFollowing) return
    const id = setTimeout(() => frame(target), 40)
    return () => clearTimeout(id)
  }, [target, isFollowing, frame])

  const ids = useMemo(() => new Set(agents.map(a => a.id)), [agents])
  const blood = useMemo(() => (hover ? lineage(hover, agents) : null), [hover, agents])
  const isDim = (id: string, areaKey?: string) => (blood ? !blood.has(id) : !!filter && id !== NAPOLEON && areaKey !== filter)
  const live = agents.filter(a => a.status === 'running').length

  const nodes: Node[] = [
    {
      id: NAPOLEON, type: 'napoleon', position: pos.get(NAPOLEON) ?? { x: 0, y: 0 }, draggable: false, measured: dims[NAPOLEON],
      data: { napoleon: state.napoleon, live, total: state.agents.length, isSelected: selected === NAPOLEON, isDimmed: isDim(NAPOLEON) },
    } satisfies NapoleonNodeT,
    ...agents.map(a => ({
      id: a.id, type: 'agent' as const, position: pos.get(a.id) ?? { x: 0, y: 0 }, draggable: false, measured: dims[a.id],
      data: { agent: a, isSelected: selected === a.id, isDimmed: isDim(a.id, a.areaKey) },
    }) satisfies AgentNodeT),
  ]

  const edges: BranchT[] = agents.map(a => {
    const parent = parentOf(a, ids)
    const id = `e-${parent}-${a.id}`
    return {
      id, source: parent, target: a.id, type: 'branch',
      sourceHandle: dir === 'down' ? 'b' : 'r', targetHandle: dir === 'down' ? 't' : 'l',
      data: { dir, isLive: a.status === 'running', isFailed: a.status === 'failed' || a.status === 'killed', isDimmed: isDim(a.id, a.areaKey), pulses: pulses.filter(p => p.edge === id) },
    }
  })

  return (
    <div className="canvas" ref={canvas}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => onSelect(n.id === selected ? undefined : n.id)}
        onNodeMouseEnter={(_, n) => setHover(n.id)}
        onNodeMouseLeave={() => setHover(undefined)}
        onPaneClick={() => onSelect(undefined)}
        onMoveStart={(e, vp) => { moveFrom.current = e ? vp : null }}
        onMoveEnd={(e, vp) => {
          const f = moveFrom.current
          if (e && f && (Math.abs(f.x - vp.x) > 4 || Math.abs(f.y - vp.y) > 4 || f.zoom !== vp.zoom)) setFollowing(false)
        }}
        nodesConnectable={false}
        minZoom={0.08}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      />
      <AnimatePresence>
        {!isFollowing && (
          <motion.button className="follow txt" onClick={() => fitRef.current()} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
            volver a encuadrar · F
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(location.search).has('demo') ? 'demo' : 'live'))
  const [isTimelineOn, setTimeline] = useState(() => store.get('hq.timeline') === '1')
  const [filter, setFilter] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [isPaletteOpen, setPalette] = useState(false)
  const fitRef = useRef<() => void>(() => undefined)
  const focusRef = useRef<(id: string) => void>(() => undefined)
  const { state, link } = useHQ(mode)
  const view = state ?? EMPTY

  const toggleMode = useCallback(() => { setSelected(undefined); setMode(m => (m === 'demo' ? 'live' : 'demo')) }, [])
  const toggleTimeline = useCallback(() => setTimeline(v => (store.set('hq.timeline', v ? '0' : '1'), !v)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(v => !v); return }
      if (isPaletteOpen || (e.target as HTMLElement).closest('input, textarea')) return
      const k = e.key.toLowerCase()
      if (k === 'f') fitRef.current()
      else if (k === 't') toggleTimeline()
      else if (k === 'd') toggleMode()
      else if (k === 'escape') { setSelected(undefined); setFilter(undefined) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPaletteOpen, toggleMode, toggleTimeline])

  const counts = useMemo(() => new Map(AREAS.map(a => [a.key, view.agents.filter(x => x.areaKey === a.key).length])), [view.agents])

  return (
    <ReactFlowProvider>
      <div className="app">
        <TopBar state={state} mode={mode} link={link} isTimelineOn={isTimelineOn} onMode={toggleMode} onTimeline={toggleTimeline} onPalette={() => setPalette(true)} />
        <main className="stage">
          <Graph state={view} selected={selected} filter={filter} onSelect={setSelected} fitRef={fitRef} focusRef={focusRef} />

          <nav className="legend">
            {AREAS.filter(a => counts.get(a.key)).map(a => (
              <button key={a.key} className={`txt ${filter === a.key ? 'is-on' : ''} ${filter && filter !== a.key ? 'is-off' : ''}`} onClick={() => setFilter(f => (f === a.key ? undefined : a.key))}>
                <i className="dot" style={{ background: a.color }} />{a.label} <span className="faint">{counts.get(a.key)}</span>
              </button>
            ))}
          </nav>

          <AnimatePresence>
            {view.agents.length === 0 && mode === 'live' && (
              <motion.p className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Sin agentes. Dile a Claude «me llegó esta tarea…» y la verás nacer aquí. <button className="txt is-on" onClick={toggleMode}>ver demo</button>
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {selected && <Inspector state={view} id={selected} isDemo={mode === 'demo'} onClose={() => setSelected(undefined)} onSelect={id => { setSelected(id); focusRef.current(id) }} />}
          </AnimatePresence>
        </main>
        <AnimatePresence initial={false}>
          {isTimelineOn && (
            <motion.footer className="dock" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
              <Timeline state={view} selected={selected} onSelect={setSelected} />
            </motion.footer>
          )}
        </AnimatePresence>
        <Palette
          isOpen={isPaletteOpen} state={state} filter={filter} onOpenChange={setPalette}
          onSelect={id => { setSelected(id); focusRef.current(id) }} onFilter={setFilter}
          onFit={() => fitRef.current()} onTimeline={toggleTimeline} onMode={toggleMode}
        />
      </div>
    </ReactFlowProvider>
  )
}
