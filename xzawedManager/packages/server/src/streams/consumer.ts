import { z } from 'zod'
import type { OrchestratorToManagerMessage } from '../types/streams.js'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `orchestrator:to-manager:${sessionId}`
const GROUP = 'manager-consumers'

export type MessageHandler = (msg: OrchestratorToManagerMessage) => Promise<void>

// Runtime validation schema for messages received from Redis Streams.
// Prevents unvalidated data from reaching the handler (Vuln 7).
const TaskRequestSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.literal('task_request'),
  payload: z.object({
    intent: z.string(),
    context: z.record(z.unknown()),
    priority: z.enum(['normal', 'high']),
  }),
})

const InfoResponseSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.literal('info_response'),
  payload: z.object({ answer: z.string() }),
})

const AbortSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.literal('abort'),
  payload: z.record(z.never()),
})

const OrchestratorToManagerMessageSchema = z.union([
  TaskRequestSchema,
  InfoResponseSchema,
  AbortSchema,
])

export class StreamConsumer {
  private running = false

  constructor(private readonly redisUrl: string) {}

  async ensureGroup(sessionId: string): Promise<void> {
    const redis = getRedisClient(this.redisUrl)
    try {
      await redis.xgroup('CREATE', streamKey(sessionId), GROUP, '$', 'MKSTREAM')
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err
    }
  }

  private parseMessage(
    id: string,
    fields: string[],
  ): OrchestratorToManagerMessage | null {
    const dataIdx = fields.indexOf('data')
    if (dataIdx === -1) return null
    try {
      const raw: unknown = JSON.parse(fields[dataIdx + 1]!)
      const parsed = OrchestratorToManagerMessageSchema.safeParse(raw)
      if (!parsed.success) {
        console.error(
          `[StreamConsumer] Invalid message schema ${id} — ACKing to skip:`,
          parsed.error.issues,
        )
        return null
      }
      return parsed.data
    } catch {
      console.error(`[StreamConsumer] Failed to parse message ${id} — ACKing to skip`)
      return null
    }
  }

  private async processEntry(
    id: string,
    fields: string[],
    sessionId: string,
    handler: MessageHandler,
    redis: ReturnType<typeof getRedisClient>,
  ): Promise<void> {
    const msg = this.parseMessage(id, fields)
    if (!msg) {
      await redis.xack(streamKey(sessionId), GROUP, id)
      return
    }
    try {
      await handler(msg)
    } catch (err) {
      console.error(`[StreamConsumer] Handler error for message ${id}:`, err)
    }
    await redis.xack(streamKey(sessionId), GROUP, id)
  }

  async start(sessionId: string, handler: MessageHandler): Promise<void> {
    await this.ensureGroup(sessionId)
    this.running = true
    const redis = getRedisClient(this.redisUrl)
    const consumerId = `manager-${process.pid}`

    while (this.running) {
      const results = await redis.xreadgroup(
        'GROUP', GROUP, consumerId,
        'COUNT', '10', 'BLOCK', '2000',
        'STREAMS', streamKey(sessionId), '>'
      ) as [string, [string, string[]][]][] | null

      if (!results) continue

      for (const [, entries] of results) {
        for (const [id, fields] of entries) {
          await this.processEntry(id, fields, sessionId, handler, redis)
        }
      }
    }
  }

  stop(): void {
    this.running = false
  }
}
