import { z } from 'zod'

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
    content: string
  }
}

export const ManagerToDeveloperMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['develop_request', 'abort']),
  payload: z.object({
    plan: z.string(),
    projectPath: z.string(),
    context: z.record(z.unknown()),
  }),
})

export type ManagerToDeveloperMessage = z.infer<typeof ManagerToDeveloperMessageSchema>
