export type AgentRow = {
  id: string
  type: string
  area: string
  name?: string
  description: string
  status: string
  parentId?: string
  tool?: string
  calls: number
  startedAt: number
  endedAt?: number
}
export type View = { main?: string; mainCalls: number; agents: AgentRow[] }

// what Napoleon HQ (the web app) reads; the pane never reads it, so writing it redraws nothing
export type LogEntry = { t: number; tool: string; detail?: string }
export type Usage = { input: number; output: number; cacheRead: number; model: string }
// one message to an agent: the prompt that created it, a SendMessage, or an order typed in HQ
export type Msg = { t: number; from: string; text: string; status?: string }
export type Feed = {
  sessionStart: number
  main: LogEntry[]
  logs: Record<string, LogEntry[]>
  answers: Record<string, string>
  usage: Record<string, Usage>
  convo: Record<string, Msg[]> // '' = Napoleon
  pending: { description: string; text: string; t: number }[] // Agent prompts not yet matched to an agent id
  lastSeq: number // last HQ order delivered from the outbox
}

declare module 'claude-code' {
  interface PluginState {
    orquestador: { view: View; feed: Feed }
  }
}
