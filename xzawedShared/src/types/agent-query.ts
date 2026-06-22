import { z } from 'zod'

/** 에이전트 간 질의 페이로드 스키마 — agent_query 메시지의 payload 검증에 사용. */
export const AgentQuerySchema = z.object({
  to: z.string().min(1),
  question: z.string().min(1),
  kind: z.enum(['active_request', 'cross_check']).default('active_request'),
})

export type AgentQueryKind = 'active_request' | 'cross_check'
export type AgentQueryPayload = z.infer<typeof AgentQuerySchema>

/**
 * 협업 에이전트가 수신 메시지 payload에 공통으로 갖는 입력 필드.
 * 각 에이전트의 ManagerTo{Agent}MessageSchema payload에 spread해 중복을 방지한다.
 * clarificationContext: 다른 에이전트의 답, query/queryKind: 질의 답변 모드.
 * model: D5 Manager가 주입하는 라우팅된 concrete model id. 에이전트가 payload.model ?? config.CLAUDE_MODEL로 소비.
 */
export const collaborationPayloadFields = {
  clarificationContext: z.string().optional(),
  query: z.string().optional(),
  queryKind: z.enum(['active_request', 'cross_check']).optional(),
  model: z.string().optional(),
} as const

/**
 * 에이전트가 다른 에이전트에게 질의할 때 runner가 반환하는 클래스.
 * handle()에서 instanceof로 분기해 agent_query 메시지로 발행한다.
 * (Planner의 ClarificationNeeded 패턴을 일반화한 것)
 */
export class AgentQuery {
  constructor(
    public readonly to: string,
    public readonly question: string,
    public readonly kind: AgentQueryKind = 'active_request',
  ) {}
}

/**
 * Claude 응답 JSON에서 agent_query를 감지해 AgentQuery를 만든다.
 * `{ agent_query: true, to, question, kind }` 형태면 인스턴스, 아니면 null.
 */
export function parseAgentQuery(parsed: Record<string, unknown>): AgentQuery | null {
  if (parsed['agent_query'] !== true) return null
  const to = String(parsed['to'] ?? '')
  const question = String(parsed['question'] ?? '')
  if (to === '' || question === '') return null
  const kind: AgentQueryKind = parsed['kind'] === 'cross_check' ? 'cross_check' : 'active_request'
  return new AgentQuery(to, question, kind)
}
