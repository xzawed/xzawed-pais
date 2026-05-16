import { z } from 'zod'

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
    content: string
  }
}

export const ManagerToTesterMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['test_request', 'abort']),
  payload: z.object({
    projectPath: z.string(),
    testCommand: z.string().optional(),
    testFiles: z.array(z.string()).optional(),
    context: z.record(z.unknown()),
  }),
})

export type ManagerToTesterMessage = z.infer<typeof ManagerToTesterMessageSchema>
