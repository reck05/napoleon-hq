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
  engine?: 'codex' | 'claude'
  updatedAt: number
  sessionStart: number
  napoleon: { tool?: string; calls: number; log: LogEntry[]; voice: string; usage?: Usage; convo?: Msg[] }
  agents: Agent[]
  peers?: Peer[]
}

// another agent or account talking to Napoleon through HQ (Codex, a second Claude Code)
export type Peer = { name: string; firstSeen: number; lastSeen: number; isWaiting: boolean; count: number }

export type Pulse = { id: string; edge: string; kind: 'spawn' | 'call' | 'report' | 'fail'; color: string; at: number }

export const NAPOLEON = 'napoleon'

export type Project = { id: string; name: string; kind: 'local' | 'chatgpt'; path: string | null; url: string | null; available: boolean; active: boolean }
export type PendingRequest = { id: string | number; method: string; params: { command?: string; reason?: string; threadId?: string; permissions?: unknown; questions?: { id: string; question: string; options?: { label: string; description: string }[] }[] } }
export type Connection = { engine: 'codex' | 'claude'; connected: boolean; authenticated: boolean; error: string; activeProjectId: string | null; projectName: string | null; busy: boolean; requests: PendingRequest[]; deviceId?: string; deviceLabel?: string }
