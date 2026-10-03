import { motion } from 'motion/react'
import { Conversation } from './Conversation'
import { areaOf } from './areas'
import { parentOf } from './layout'
import { clockOf, fmtDur, fmtTokens, statusLabel, useNow } from './util'
import { NAPOLEON, type Agent, type HQState, type LogEntry, type Usage } from './types'

type Props = { state: HQState; id: string; isDemo: boolean; deviceId?: string; connected: boolean; onClose: () => void; onSelect: (id: string) => void }

const tokens = (u?: Usage) => (u ? `${fmtTokens(u.input)} / ${fmtTokens(u.output)}` : '—')

function Log({ log, from }: { log: LogEntry[]; from: number }) {
  if (!log.length) return <p className="faint">Nada todavía.</p>
  return (
    <ol className="i-log">
      {[...log].reverse().slice(0, 40).map((l, i) => (
        <motion.li key={`${l.t}-${l.tool}`} initial={i === 0 ? { opacity: 0, x: 8 } : false} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }}>
          <span className="i-t">{fmtDur(l.t - from)}</span>
          <span className="i-tool">{l.tool}</span>
          <span className="i-detail">{l.detail}</span>
        </motion.li>
      ))}
    </ol>
  )
}

export function Inspector({ state, id, isDemo, deviceId, connected, onClose, onSelect }: Props) {
  const now = useNow(1000)
  const ids = new Set(state.agents.map(a => a.id))
  const isRoot = id === NAPOLEON
  const a = state.agents.find(x => x.id === id)
  if (!isRoot && !a) return null

  const kids = state.agents.filter(x => parentOf(x, ids) === id)
  const line: Agent[] = []
  for (let cur = a; cur; cur = state.agents.find(x => x.id === parentOf(cur!, ids))) line.unshift(cur)

  return (
    <motion.aside className="insp" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      <motion.div key={id} initial={{ opacity: 0, filter: 'blur(6px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.4 }}>
        <div className="i-head">
          <span className="i-kicker">{isRoot ? 'orquestador' : a!.area.toLowerCase()}</span>
          <button className="txt" onClick={onClose}>cerrar</button>
        </div>
        <h2 className="i-title">{isRoot ? 'Napoleon' : a!.description}</h2>

        {!isRoot && (
          <p className="i-status">
            <i className={`dot dot-${a!.status === 'running' ? 'live' : a!.status === 'completed' ? 'done' : 'fail'}`} style={{ ['--c' as string]: areaOf(a!.areaKey).color }} />
            {statusLabel(a!.status)} · desde {clockOf(a!.startedAt)} · {fmtDur((a!.endedAt ?? now) - a!.startedAt)}
          </p>
        )}

        <dl className="i-nums">
          {isRoot ? (
            <>
              <div><dt>agentes</dt><dd>{state.agents.length}</dd></div>
              <div><dt>activos</dt><dd>{state.agents.filter(x => x.status === 'running').length}</dd></div>
              <div><dt>llamadas</dt><dd>{state.napoleon.calls}</dd></div>
              <div><dt>tokens</dt><dd>{tokens(state.napoleon.usage)}</dd></div>
            </>
          ) : (
            <>
              <div><dt>llamadas</dt><dd>{a!.calls}</dd></div>
              <div><dt>tokens</dt><dd>{tokens(a!.usage)}</dd></div>
              <div><dt>caché</dt><dd>{a!.usage ? fmtTokens(a!.usage.cacheRead) : '—'}</dd></div>
              <div><dt>modelo</dt><dd>{a!.usage?.model.replace('claude-', '') ?? '—'}</dd></div>
            </>
          )}
        </dl>

        {(isRoot ? state.napoleon.voice : a!.voice) && (
          <section>
            <h3>en directo</h3>
            <p className="i-voice">{isRoot ? state.napoleon.voice : a!.voice}<span className="caret" /></p>
          </section>
        )}

        {a?.type === 'peer' ? (
          <section className="convo">
            <h3>conversación con Napoleon <span className="faint">{a.convo?.length ?? 0}</span></h3>
            <ul className="c-list">
              {(a.convo ?? []).map(m => (
                <li key={`${m.t}-${m.from}`} className={`c-msg ${m.from === 'Napoleon' ? 'is-answer' : 'is-you'}`}>
                  <div className="c-meta"><span>{m.from}</span><span className="faint">{clockOf(m.t)}</span></div>
                  <div className="c-text">{m.text}</div>
                </li>
              ))}
            </ul>
            <p className="faint">{a.description} habla con Napoleon desde su propia app, con la herramienta ask_claude.</p>
          </section>
        ) : <Conversation
          to={id}
          agentName={isRoot ? 'Napoleon' : 'agente'}
          convo={(isRoot ? state.napoleon.convo : a!.convo) ?? []}
          answer={!isRoot && a!.answer && !a!.convo?.some(m => m.text === a!.answer) ? { t: a!.endedAt ?? now, text: a!.answer } : undefined}
          isLive={isRoot || a!.status === 'running'}
          isDemo={isDemo}
          deviceId={deviceId}
          connected={connected}
        />}

        {!isRoot && (
          <section>
            <h3>linaje</h3>
            <p className="i-line">
              <button className="txt" onClick={() => onSelect(NAPOLEON)}>Napoleon</button>
              {line.map(x => (
                <span key={x.id}> <span className="faint">/</span> {x.id === id ? <span>{x.description}</span> : <button className="txt" onClick={() => onSelect(x.id)}>{x.description}</button>}</span>
              ))}
            </p>
          </section>
        )}

        {kids.length > 0 && (
          <section>
            <h3>{isRoot ? 'a sus órdenes' : 'descendencia'} <span className="faint">{kids.length}</span></h3>
            <ul className="i-kids">
              {kids.map(k => (
                <li key={k.id}>
                  <button className="txt" onClick={() => onSelect(k.id)}>
                    <i className={`dot dot-${k.status === 'running' ? 'live' : k.status === 'completed' ? 'done' : 'fail'}`} style={{ ['--c' as string]: areaOf(k.areaKey).color }} />
                    {k.description}
                  </button>
                  <span className="faint">{statusLabel(k.status)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>herramientas</h3>
          <Log log={isRoot ? state.napoleon.log : a!.log} from={isRoot ? state.sessionStart : a!.startedAt} />
        </section>

        {!isRoot && <p className="i-id faint">{a!.type} · {a!.id}</p>}
      </motion.div>
    </motion.aside>
  )
}
