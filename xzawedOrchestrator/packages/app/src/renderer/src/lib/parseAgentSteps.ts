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

type Segment = { tag: string | null; lines: string[] }

function segmentLines(lines: string[]): Segment[] {
  const segments: Segment[] = []
  let current: Segment | null = null

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
  return segments
}

function segmentToStep(s: Segment, isLast: boolean, isStreaming: boolean): AgentStep {
  const agentName: AgentName = s.tag ? (TAG_MAP[s.tag] ?? 'Assistant') : 'Assistant'
  const status: StepStatus = isLast && isStreaming ? 'active' : 'done'
  return { agentName, status, content: s.lines.join('\n').trim() }
}

export function parseAgentSteps(content: string, isStreaming = false): AgentStep[] {
  if (!content.trim()) return []

  const segments = segmentLines(content.split('\n'))

  if (segments.length === 0) return []

  if (segments.length === 1 && segments[0].tag === null) {
    return [{
      agentName: 'Assistant',
      status: isStreaming ? 'active' : 'done',
      content: segments[0].lines.join('\n').trim(),
    }]
  }

  const filtered = segments.filter((s) => s.tag !== null || s.lines.some((l) => l.trim()))
  return filtered.map((s, i) => segmentToStep(s, i === filtered.length - 1, isStreaming))
}
