import { z } from 'zod'
import { collaborationPayloadFields } from '@xzawed/agent-streams'

export interface FileChange {
  path: string
  operation: 'create' | 'modify' | 'delete'
  content?: string
}

export interface DeveloperToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'develop_complete' | 'error'
  payload: {
    artifacts?: string[]
    summary?: string
    knowledge?: string[]
    content: string
  }
}

const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
  githubRepo: z.object({ owner: z.string(), repo: z.string(), branch: z.string() }).optional(),
})

export const ManagerToDeveloperMessageSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['develop_request', 'abort']),
  payload: z.object({
    // 개발 요청 시 사용 (query 모드에서는 없음)
    plan: z.string().optional(),
    projectPath: z.string().optional(),
    context: z.record(z.unknown()),
    userContext: UserContextSchema.optional(),
    // 협업 공통 입력 필드(clarificationContext·query·queryKind)
    ...collaborationPayloadFields,
  }),
})

export type ManagerToDeveloperMessage = z.infer<typeof ManagerToDeveloperMessageSchema>
