import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { RedisAgentHandler } from './redis-agent-handler.js'

interface SecurityAuditInput {
  artifacts: string[]
  severity: 'low' | 'medium' | 'high'
  projectPath: string
  context: Record<string, unknown>
}

interface SecurityIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string
  file: string
  line?: number
  description: string
  suggestion: string
  cwe?: string
}

interface SecurityAuditOutput {
  issues: SecurityIssue[]
  score: number
  summary: string
  content: string
}

const inputSchema = {
  type: 'object' as const,
  properties: {
    artifacts: { type: 'array', items: { type: 'string' }, description: 'File paths to audit' },
    severity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Minimum severity to report' },
    projectPath: { type: 'string', description: 'Path to the project root (use the workspaceRoot provided in the system prompt)' },
    context: { type: 'object', description: 'Additional context for the audit' },
  },
  required: ['artifacts', 'severity', 'projectPath', 'context'],
}

const securityIssueSchema = z.object({
  id: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  category: z.string(),
  file: z.string(),
  line: z.number().optional(),
  description: z.string(),
  suggestion: z.string(),
  cwe: z.string().optional(),
})

const outputSchema = z.object({
  issues: z.array(securityIssueSchema).default([]),
  score: z.number().default(100),
  summary: z.string().default(''),
  content: z.string().default(''),
})

export function createSecurityAuditHandler(redisUrl: string): ToolHandler<SecurityAuditInput, SecurityAuditOutput> {
  return new RedisAgentHandler<SecurityAuditInput, SecurityAuditOutput>(
    redisUrl,
    'security',
    'audit_request',
    'audit_complete',
    'security_audit',
    'Audit code artifacts for security vulnerabilities above the specified severity',
    inputSchema,
    outputSchema as z.ZodType<SecurityAuditOutput>,
  )
}
