import { useEffect, useMemo, useRef, useState } from 'react'
import { stratify, tree } from 'd3-hierarchy'
import { NAPOLEON, type Agent } from './types'

export const NODE = { w: 200, h: 54 }
const GAP = { sibling: 14, generation: 62, siblingSide: 10, generationSide: 64 }
export type XY = { x: number; y: number }
export type Dir = 'down' | 'right'

export const parentOf = (a: Agent, ids: Set<string>) => (a.parentId && ids.has(a.parentId) ? a.parentId : NAPOLEON)

type Item = { id: string; parent?: string; t: number }

/** A family tree (Reingold–Tilford): siblings in birth order, generations in rows (down) or columns (right). */
export function familyLayout(agents: Agent[], dir: Dir): Map<string, XY> {
  const ids = new Set(agents.map(a => a.id))
  const items: Item[] = [{ id: NAPOLEON, t: 0 }, ...agents.map(a => ({ id: a.id, parent: parentOf(a, ids), t: a.startedAt }))]
  const root = stratify<Item>().id(d => d.id).parentId(d => d.parent)(items)
  root.sort((a, b) => a.data.t - b.data.t)
  const isDown = dir === 'down'
  const size: [number, number] = isDown ? [NODE.w + GAP.sibling, NODE.h + GAP.generation] : [NODE.h + GAP.siblingSide, NODE.w + GAP.generationSide]
  tree<Item>().nodeSize(size).separation((a, b) => (a.parent === b.parent ? 1 : 1.18))(root)
  const out = new Map<string, XY>()
  root.each(n => out.set(n.id!, isDown ? { x: (n.x ?? 0) - NODE.w / 2, y: n.y ?? 0 } : { x: n.y ?? 0, y: (n.x ?? 0) - NODE.h / 2 }))
  return out
}

export function bounds(m: Map<string, XY>) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of m.values()) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + NODE.w); y1 = Math.max(y1, p.y + NODE.h) }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** The orientation that shows the tree largest in this viewport; sticky unless the other is clearly better. */
export function bestDir(agents: Agent[], vw: number, vh: number, current: Dir): Dir {
  const scale = (d: Dir) => { const b = bounds(familyLayout(agents, d)); return Math.min(vw / b.width, vh / b.height) }
  const other: Dir = current === 'down' ? 'right' : 'down'
  return scale(other) > scale(current) * 1.15 ? other : current
}

// a long, soft settle: positions morph rather than jump
const ease = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))

/** Positions that glide to each new layout; a newborn starts on its parent and unfolds out of it. */
export function useFamilyTree(agents: Agent[], dir: Dir) {
  const shapeKey = agents.map(a => `${a.id}<${a.parentId ?? ''}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const target = useMemo(() => familyLayout(agents, dir), [shapeKey, dir])
  const [pos, setPos] = useState(target)
  const posRef = useRef(pos)
  posRef.current = pos

  useEffect(() => {
    const ids = new Set(agents.map(a => a.id))
    const from = new Map<string, XY>()
    for (const [id, to] of target) {
      const a = agents.find(x => x.id === id)
      from.set(id, posRef.current.get(id) ?? (a && (posRef.current.get(parentOf(a, ids)) ?? target.get(parentOf(a, ids)))) ?? to)
    }
    const t0 = performance.now()
    let raf = 0
    const step = () => {
      const k = ease(Math.min(1, (performance.now() - t0) / 1100))
      const next = new Map<string, XY>()
      for (const [id, to] of target) {
        const f = from.get(id)!
        next.set(id, { x: f.x + (to.x - f.x) * k, y: f.y + (to.y - f.y) * k })
      }
      setPos(next)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  return { pos, target }
}

/** Every ancestor and descendant of `id`: the bloodline a hover lights up. */
export function lineage(id: string, agents: Agent[]): Set<string> {
  const ids = new Set(agents.map(a => a.id))
  const out = new Set([id, NAPOLEON])
  let cur = agents.find(a => a.id === id)
  while (cur) {
    const p = parentOf(cur, ids)
    out.add(p)
    cur = agents.find(a => a.id === p)
  }
  const down = [id]
  while (down.length) {
    const p = down.pop()!
    for (const a of agents) if (parentOf(a, ids) === p && !out.has(a.id)) { out.add(a.id); down.push(a.id) }
  }
  return out
}
