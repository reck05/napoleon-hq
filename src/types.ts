// Shape of ~/.claude/napoleon/state.json, written by the orquestador mod (queueWrite in hooks/register.tsx)
export type LogEntry = { t: number; tool: string; detail?: string }
export type Usage = { input: number; output: number; cacheRead: number; model: string }
// one message to an agent: the prompt that created it, a SendMessage, or an order typed here
export type Msg = { t: number; from: string; text: string; status?: string }

export type Agent = {
  id: string
  type: string
  area: string
  areaKey: string
  description: string
  status: string
  parentId?: string
  tool?: string
  calls: number
  startedAt: number
  endedAt?: number
  log: LogEntry[]
  voice: string
  answer?: string
  usage?: Usage
  convo?: Msg[]
}

export type HQState = {
  v: 1
  updatedAt: number
  sessionStart: number
  napoleon: { tool?: string; calls: number; log: LogEntry[]; voice: string; usage?: Usage; convo?: Msg[] }
  agents: Agent[]
}

export type Pulse = { id: string; edge: string; kind: 'spawn' | 'call' | 'report' | 'fail'; color: string; at: number }

export const NAPOLEON = 'napoleon'
