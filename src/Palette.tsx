import { Command } from 'cmdk'
import { AREAS, areaOf } from './areas'
import { statusLabel } from './util'
import { NAPOLEON, type HQState } from './types'

type Props = {
  isOpen: boolean
  state: HQState | null
  filter?: string
  onOpenChange: (v: boolean) => void
  onSelect: (id: string) => void
  onFilter: (key?: string) => void
  onFit: () => void
  onTimeline: () => void
  onMode: () => void
}

export function Palette(p: Props) {
  const run = (fn: () => void) => () => { fn(); p.onOpenChange(false) }
  return (
    <Command.Dialog open={p.isOpen} onOpenChange={p.onOpenChange} label="Paleta de comandos" className="pal" overlayClassName="pal-bg">
      <Command.Input placeholder="Agente, área o acción" autoFocus />
      <Command.List>
        <Command.Empty>Nada.</Command.Empty>
        <Command.Group heading="agentes">
          <Command.Item value="napoleon orquestador" onSelect={run(() => p.onSelect(NAPOLEON))}>Napoleon<span>orquestador</span></Command.Item>
          {[...(p.state?.agents ?? [])].reverse().map(a => (
            <Command.Item key={a.id} value={`${a.description} ${a.area} ${a.id}`} onSelect={run(() => p.onSelect(a.id))}>
              <i className="dot" style={{ background: areaOf(a.areaKey).color }} />
              {a.description}
              <span>{statusLabel(a.status)}</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="filtrar por área">
          {p.filter && <Command.Item onSelect={run(() => p.onFilter(undefined))}>Quitar filtro</Command.Item>}
          {AREAS.map(a => (
            <Command.Item key={a.key} value={`filtrar ${a.label}`} onSelect={run(() => p.onFilter(a.key))}>
              <i className="dot" style={{ background: a.color }} />{a.label}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="vista">
          <Command.Item onSelect={run(p.onFit)}>Encuadrar todo<kbd>F</kbd></Command.Item>
          <Command.Item onSelect={run(p.onTimeline)}>Línea de tiempo<kbd>T</kbd></Command.Item>
          <Command.Item onSelect={run(p.onMode)}>Demo o en vivo<kbd>D</kbd></Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
