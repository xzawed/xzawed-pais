import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { RedisAgentHandler } from './redis-agent-handler.js'

interface WatchChangesInput {
  projectPath: string
  triggers: string[]
  context: Record<string, unknown>
  debounceMs?: number
}

interface FileEvent {
  path: string
  event: 'add' | 'change' | 'unlink'
  timestamp: number
}

interface WatchChangesOutput {
  watcherId: string
  content: string
  changes?: FileEvent[]
}

const inputSchema = {
  type: 'object' as const,
  properties: {
    projectPath: { type: 'string', description: 'Absolute path to the project root to watch' },
    triggers: { type: 'array', items: { type: 'string' }, description: 'Glob patterns that trigger actions (e.g. **/*.ts)' },
    debounceMs: { type: 'number', description: 'Debounce delay in ms (default: 300)' },
    context: { type: 'object', description: 'Additional context for the watcher' },
  },
  required: ['projectPath', 'triggers', 'context'],
}

const fileEventSchema = z.object({
  path: z.string(),
  event: z.enum(['add', 'change', 'unlink']),
  timestamp: z.number(),
})

const outputSchema = z.object({
  watcherId: z.string().default(''),
  content: z.string().default(''),
  changes: z.array(fileEventSchema).optional(),
})

export function createWatchChangesHandler(redisUrl: string): ToolHandler<WatchChangesInput, WatchChangesOutput> {
  return new RedisAgentHandler<WatchChangesInput, WatchChangesOutput>(
    redisUrl,
    'watcher',
    'watch_request',
    'watch_started',
    'watch_changes',
    'Start a file watcher that triggers actions on file changes in the project',
    inputSchema,
    outputSchema as unknown as z.ZodType<WatchChangesOutput>,
  )
}
