import { useEffect, useState } from 'react'

export function useNow(ms = 250) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const fmtAgo = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000))
  return s < 2 ? 'ahora' : s < 60 ? `hace ${s}s` : `hace ${Math.floor(s / 60)}m`
}

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)))

export const clockOf = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour12: false })

export const statusLabel = (s: string) =>
  s === 'running' ? 'en marcha' : s === 'completed' ? 'hecho' : s === 'failed' ? 'falló' : s === 'killed' ? 'detenido' : s === 'idle' ? 'conectado' : s

export const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

// calls per bin over the last `span` ms, for the node sparkline
export function activity(times: number[], now: number, bins = 14, span = 70_000) {
  const out = new Array(bins).fill(0)
  for (const t of times) {
    const i = Math.floor((t - (now - span)) / (span / bins))
    if (i >= 0 && i < bins) out[i]++
  }
  return out
}
