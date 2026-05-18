export type AgentName =
  | 'Manager'
  | 'Planner'
  | 'Developer'
  | 'Designer'
  | 'Tester'
  | 'Builder'
  | 'Watcher'
  | 'Security'
  | 'Assistant'

export type StepStatus = 'done' | 'active' | 'waiting' | 'error'

export interface AgentStep {
  agentName: AgentName
  status: StepStatus
  content: string
  durationMs?: number
}

const TAG_MAP: Record<string, AgentName> = {
  MGR: 'Manager',
  PLN: 'Planner',
  DEV: 'Developer',
  DES: 'Designer',
  TST: 'Tester',
  BLD: 'Builder',
  WCH: 'Watcher',
  SCR: 'Security',
}

const AGENT_TAG_RE = /^\[([A-Z]{2,3})\]\s?/

export function parseAgentSteps(content: string, isStreaming = false): AgentStep[] {
  if (!content.trim()) return []

  const lines = content.split('\n')
  const segments: Array<{ tag: string | null; lines: string[] }> = []
  let current: { tag: string | null; lines: string[] } | null = null

  for (const line of lines) {
    const match = line.match(AGENT_TAG_RE)
    if (match) {
      if (current) segments.push(current)
      current = { tag: match[1], lines: [line.replace(AGENT_TAG_RE, '')] }
    } else {
      if (!current) current = { tag: null, lines: [] }
      current.lines.push(line)
    }
  }
  if (current) segments.push(current)

  if (segments.length === 0) return []

  if (segments.length === 1 && segments[0].tag === null) {
    return [{
      agentName: 'Assistant',
      status: isStreaming ? 'active' : 'done',
      content: segments[0].lines.join('\n').trim(),
    }]
  }

  return segments
    .filter((s) => s.tag !== null || s.lines.some((l) => l.trim()))
    .map((s, i, arr) => {
      const agentName: AgentName = s.tag ? (TAG_MAP[s.tag] ?? 'Assistant') : 'Assistant'
      const isLast = i === arr.length - 1
      const status: StepStatus = isLast && isStreaming ? 'active' : 'done'
      return { agentName, status, content: s.lines.join('\n').trim() }
    })
}
