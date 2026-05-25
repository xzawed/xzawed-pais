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
    plan: z.string(),
    projectPath: z.string(),
    context: z.record(z.unknown()),
    userContext: UserContextSchema.optional(),
  }),
})

export type ManagerToDeveloperMessage = z.infer<typeof ManagerToDeveloperMessageSchema>
