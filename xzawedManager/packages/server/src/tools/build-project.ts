import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { RedisAgentHandler } from './redis-agent-handler.js'
import type { Bulkhead } from '@xzawed/agent-streams'

interface BuildProjectInput {
  projectPath: string
  target: string
  context: Record<string, unknown>
}
interface BuildProjectOutput { success: boolean; output: string; artifacts: string[] }

const inputSchema = {
  type: 'object' as const,
  properties: {
    projectPath: { type: 'string', description: 'Path to the project root (use the workspaceRoot provided in the system prompt)' },
    target: { type: 'string', enum: ['development', 'production'], description: 'Build target' },
    context: { type: 'object', description: 'Additional context for the build' },
  },
  required: ['projectPath', 'target', 'context'],
}

const outputSchema = z.object({
  success: z.boolean().default(false),
  output: z.string().default(''),
  artifacts: z.array(z.string()).default([]),
})

export function createBuildProjectHandler(redisUrl: string, bulkhead?: Bulkhead): ToolHandler<BuildProjectInput, BuildProjectOutput> {
  return new RedisAgentHandler<BuildProjectInput, BuildProjectOutput>(
    redisUrl,
    'builder',
    'build_request',
    'build_complete',
    'build_project',
    'Build the project at the specified path for the given target',
    inputSchema,
    outputSchema as z.ZodType<BuildProjectOutput>,
    undefined,
    bulkhead,
  )
}
