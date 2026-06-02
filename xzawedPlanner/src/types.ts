import { z } from 'zod'
import { collaborationPayloadFields } from '@xzawed/agent-streams'

export interface Step {
  id: string
  title: string
  description: string
  agentType: 'developer' | 'designer' | 'tester' | 'builder' | 'watcher' | 'security'
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
