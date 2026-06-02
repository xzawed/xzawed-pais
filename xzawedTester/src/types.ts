import { z } from 'zod'
import { collaborationPayloadFields } from '@xzawed/agent-streams'

export interface TestFailure {
  file: string
  testName: string
  message: string
  suggestion: string
}

export interface TesterToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'test_complete' | 'error'
  payload: {
    success?: boolean
    passed?: number
    failed?: number
    failures?: TestFailure[]
    duration?: number
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

export const ManagerToTesterMessageSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['test_request', 'abort']),
  payload: z.object({
    projectPath: z.string(),
    testCommand: z.string().optional(),
    testFiles: z.array(z.string()).optional(),
    context: z.record(z.unknown()),
    userContext: UserContextSchema.optional(),
    ...collaborationPayloadFields,
  }),
})

export type ManagerToTesterMessage = z.infer<typeof ManagerToTesterMessageSchema>
