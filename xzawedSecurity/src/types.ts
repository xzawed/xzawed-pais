import path from 'node:path'
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

const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
  githubRepo: z.object({ owner: z.string(), repo: z.string(), branch: z.string() }).optional(),
})

export const ManagerToSecurityMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['audit_request', 'abort']),
  payload: z.object({
    artifacts: z.array(
      z.string().refine(
        (s) => !path.isAbsolute(s) && !s.includes('..'),
        { message: 'artifacts must be relative paths without path traversal' },
      ),
    ),
    projectPath: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    context: z.record(z.unknown()),
    userContext: UserContextSchema.optional(),
  }),
})

export type ManagerToSecurityMessage = z.infer<typeof ManagerToSecurityMessageSchema>
