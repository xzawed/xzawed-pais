import { z } from 'zod'

export interface SecurityIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string
  file: string
  line?: number
  description: string
  suggestion: string
  cwe?: string
}

export interface SecurityToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'audit_complete' | 'error'
  payload: {
    issues?: SecurityIssue[]
    score?: number
    summary?: string
    content: string
  }
}

export const ManagerToSecurityMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['audit_request', 'abort']),
  payload: z.object({
    artifacts: z.array(z.string()),
    projectPath: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    context: z.record(z.unknown()),
  }),
})

export type ManagerToSecurityMessage = z.infer<typeof ManagerToSecurityMessageSchema>
