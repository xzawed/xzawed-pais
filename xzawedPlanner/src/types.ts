import { z } from 'zod'
import { collaborationPayloadFields } from '@xzawed/agent-streams'

/**
 * Planner가 단계에 배정할 수 있는 에이전트 타입의 **단일 소스**.
 * StepSchema(z.enum)·SYSTEM_PROMPT 열거·Step.agentType 타입이 모두 이 튜플에서 파생되어
 * 셋 사이의 드리프트(예: 새 에이전트 추가 시 일부만 갱신)를 원천 차단한다.
 */
export const AGENT_TYPES = ['developer', 'designer', 'tester', 'builder', 'watcher', 'security'] as const
export type AgentType = (typeof AGENT_TYPES)[number]

export interface Step {
  id: string
  title: string
  description: string
  agentType: AgentType
  dependencies: string[]
  estimatedMinutes: number
}

export interface UISpec {
  type: 'form'
  fields: Array<{
    id: string
    label: string
    type: 'text' | 'select' | 'textarea'
    options?: string[]
    required?: boolean
  }>
}

export interface PlannerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'plan_complete' | 'info_request' | 'error' | 'agent_query'
  payload: {
    steps?: Step[]
    estimatedTime?: string
    knowledge?: (string | { content: string; category?: string })[]
    content: string
    uiSpec?: UISpec
    to?: string
    question?: string
    kind?: 'active_request' | 'cross_check'
  }
}

const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
  githubRepo: z.object({ owner: z.string(), repo: z.string(), branch: z.string() }).optional(),
})

export const ManagerToPlannerMessageSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['plan_request', 'abort']),
  payload: z.object({
    intent: z.string().min(1).max(4000),
    context: z.record(z.unknown()),
    priority: z.enum(['normal', 'high']),
    userContext: UserContextSchema.optional(),
    ...collaborationPayloadFields,
  }),
})

export type ManagerToPlannerMessage = z.infer<typeof ManagerToPlannerMessageSchema>
