import type { OrchestratorToManagerMessage } from '../types/streams.js'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `orchestrator:to-manager:${sessionId}`
const GROUP = 'manager-consumers'

export type MessageHandler = (msg: OrchestratorToManagerMessage) => Promise<void>

export class StreamConsumer {
  private running = false

  constructor(private redisUrl: string) {}

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
          const dataIdx = fields.indexOf('data')
          if (dataIdx === -1) continue
          let msg: OrchestratorToManagerMessage
          try {
            msg = JSON.parse(fields[dataIdx + 1]!) as OrchestratorToManagerMessage
          } catch {
            console.error(`[StreamConsumer] Failed to parse message ${id} — ACKing to skip`)
            await redis.xack(streamKey(sessionId), GROUP, id)
            continue
          }
          try {
            await handler(msg)
          } catch (err) {
            console.error(`[StreamConsumer] Handler error for message ${id}:`, err)
          }
          await redis.xack(streamKey(sessionId), GROUP, id)
        }
      }
    }
  }

  stop(): void {
    this.running = false
  }
}
