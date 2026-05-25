import { z } from 'zod'
import type { ManagerToOrchestratorMessage } from '@xzawed/shared'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `manager:to-orchestrator:${sessionId}`
const GROUP = 'orchestrator-consumers'

const ManagerToOrchestratorMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['status_update', 'info_request', 'task_complete', 'error']),
  payload: z.object({
    agentId: z.string(),
    content: z.string(),
    uiSpec: z.unknown().optional(),
  }),
})

export type MessageHandler = (msg: ManagerToOrchestratorMessage) => Promise<void>

type RedisEntry = [string, string[]]
type RedisResult = [string, RedisEntry[]][]

function parseRedisEntry(fields: string[]): ManagerToOrchestratorMessage | null {
  const dataIdx = fields.indexOf('data')
  if (dataIdx === -1) return null
  const raw = fields[dataIdx + 1]
  if (raw === undefined) return null
  try {
    const parsed = ManagerToOrchestratorMessageSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      console.error('[StreamConsumer] invalid message, skipping:', parsed.error.issues)
      return null
    }
    return parsed.data as ManagerToOrchestratorMessage
  } catch (err: unknown) {
    console.error('[StreamConsumer] JSON parse error, skipping:', err)
    return null
  }
}

async function processEntries(
  entries: RedisEntry[],
  handler: MessageHandler,
  ack: (id: string) => Promise<unknown>,
): Promise<void> {
  for (const [id, fields] of entries) {
    const msg = parseRedisEntry(fields)
    if (msg === null) {
      await ack(id)
      continue
    }
    try {
      await handler(msg)
    } finally {
      await ack(id)
    }
  }
}

export class StreamConsumer {
  private running = false
  private readonly redisUrl: string

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl
  }

  async ensureGroup(sessionId: string): Promise<void> {
    const redis = getRedisClient(this.redisUrl)
    try {
      await redis.xgroup('CREATE', streamKey(sessionId), GROUP, '$', 'MKSTREAM')
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err
    }
  }

  async start(sessionId: string, handler: MessageHandler): Promise<void> {
    await this.ensureGroup(sessionId)
    this.running = true
    const redis = getRedisClient(this.redisUrl)
    const consumerId = `consumer-${process.pid}-${sessionId}`
    const ack = (id: string) => redis.xack(streamKey(sessionId), GROUP, id)

    while (this.running) {
      let results: RedisResult | null = null
      try {
        results = await redis.xreadgroup(
          'GROUP', GROUP, consumerId,
          'COUNT', '10', 'BLOCK', '2000',
          'STREAMS', streamKey(sessionId), '>'
        ) as RedisResult | null
      } catch (err: unknown) {
        if (!this.running) return
        console.error('[StreamConsumer] xreadgroup error:', err)
        continue
      }

      if (!results) continue

      for (const [, entries] of results) {
        await processEntries(entries, handler, ack)
      }
    }
  }

  stop(): void {
    this.running = false
  }
}
