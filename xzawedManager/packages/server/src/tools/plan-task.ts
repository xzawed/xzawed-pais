import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { RedisAgentHandler } from './redis-agent-handler.js'
import type { Bulkhead } from '@xzawed/agent-streams'

interface PlanTaskInput {
  intent: string
  context: Record<string, unknown>
  priority: 'normal' | 'high'
}

export interface Step {
  id: string
  title: string
  description: string
  agentType: 'developer' | 'designer' | 'tester' | 'builder' | 'watcher' | 'security'
  dependencies: string[]
  estimatedMinutes: number
}

type KnowledgeItem = string | { content: string; category?: string }
interface PlanTaskOutput { steps: Step[]; estimatedTime: string; knowledge?: KnowledgeItem[] }

const inputSchema = {
  type: 'object' as const,
  properties: {
    intent: { type: 'string', description: 'The development task to plan' },
    context: { type: 'object', description: 'Additional context for planning' },
    priority: { type: 'string', enum: ['normal', 'high'], description: 'Execution priority' },
  },
  required: ['intent', 'context', 'priority'],
}

const stepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  agentType: z.enum(['developer', 'designer', 'tester', 'builder', 'watcher', 'security']),
  dependencies: z.array(z.string()),
  estimatedMinutes: z.number(),
})

const outputSchema = z.object({
  steps: z.array(stepSchema).default([]),
  estimatedTime: z.string().default('unknown'),
  knowledge: z.array(z.union([
    z.string(),
    z.object({ content: z.string(), category: z.string().optional() }),
  ])).optional(),
})

export function createPlanTaskHandler(redisUrl: string, bulkhead?: Bulkhead): ToolHandler<PlanTaskInput, PlanTaskOutput> {
  return new RedisAgentHandler<PlanTaskInput, PlanTaskOutput>(
    redisUrl,
    'planner',
    'plan_request',
    'plan_complete',
    'plan_task',
    'Create a detailed step-by-step implementation plan for a development task',
    inputSchema,
    outputSchema as z.ZodType<PlanTaskOutput>,
    undefined,
    bulkhead,
  )
}
