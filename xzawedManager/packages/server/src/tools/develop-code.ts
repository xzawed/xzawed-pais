import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { RedisAgentHandler } from './redis-agent-handler.js'

interface DevelopCodeInput {
  plan: string
  projectPath: string
  context: Record<string, unknown>
}

interface DevelopCodeOutput {
  artifacts: string[]
  summary: string
  content: string
}

const inputSchema = {
  type: 'object' as const,
  properties: {
    plan: { type: 'string', description: 'The implementation plan to execute' },
    projectPath: { type: 'string', description: 'Path to the project root (use the workspaceRoot provided in the system prompt)' },
    context: { type: 'object', description: 'Additional context for development' },
  },
  required: ['plan', 'projectPath', 'context'],
}

const outputSchema = z.object({
  artifacts: z.array(z.string()).default([]),
  summary: z.string().default(''),
  content: z.string().default(''),
})

export function createDevelopCodeHandler(redisUrl: string): ToolHandler<DevelopCodeInput, DevelopCodeOutput> {
  return new RedisAgentHandler<DevelopCodeInput, DevelopCodeOutput>(
    redisUrl,
    'developer',
    'develop_request',
    'develop_complete',
    'develop_code',
    'Implement code according to a plan for the specified project',
    inputSchema,
    outputSchema as z.ZodType<DevelopCodeOutput>,
  )
}
