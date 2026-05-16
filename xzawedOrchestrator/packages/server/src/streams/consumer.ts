import type { ManagerToOrchestratorMessage } from '@xzawed/shared'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `manager:to-orchestrator:${sessionId}`
const GROUP = 'orchestrator-consumers'

export type MessageHandler = (msg: ManagerToOrchestratorMessage) => Promise<void>

export class StreamConsumer {
  private running = false
  private redisUrl: string

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
    const consumerId = `consumer-${process.pid}`

    while (this.running) {
      const results = await redis.xreadgroup(
        'GROUP', GROUP, consumerId,
        'COUNT', '10', 'BLOCK', '2000',
        'STREAMS', streamKey(sessionId), '>'
      ) as [string, [string, string[]][]][] | null

      if (!results) continue

      for (const [, entries] of results) {
        for (const [id, fields] of entries) {
          const dataIdx = fields.indexOf('data')
          if (dataIdx === -1) continue
          const msg = JSON.parse(fields[dataIdx + 1]) as ManagerToOrchestratorMessage
          await handler(msg)
          await redis.xack(streamKey(sessionId), GROUP, id)
        }
      }
    }
  }

  stop(): void {
    this.running = false
  }
}
