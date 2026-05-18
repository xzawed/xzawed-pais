import { z } from 'zod'

export interface BuildError {
  file?: string
  line?: number
  message: string
  suggestion: string
}

export interface BuilderToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'build_complete' | 'build_progress' | 'error'
  payload: {
    success?: boolean
    output?: string
    artifacts?: string[]
    duration?: number
    errors?: BuildError[]
    content: string
  }
}

const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
  githubRepo: z.object({ owner: z.string(), repo: z.string(), branch: z.string() }).optional(),
})

export const ManagerToBuilderMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['build_request', 'abort']),
  payload: z.object({
    projectPath: z.string(),
    target: z.enum(['development', 'production']),
    command: z.string().optional(),
    context: z.record(z.unknown()),
    userContext: UserContextSchema.optional(),
  }),
})

export type ManagerToBuilderMessage = z.infer<typeof ManagerToBuilderMessageSchema>
