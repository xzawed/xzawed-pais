import type { Redis } from 'ioredis'
import { ManagerToPlannerMessageSchema } from '../types.js'
import type { ManagerToPlannerMessage } from '../types.js'

const CONSUMER_GROUP = 'planner-consumers'
const CONSUMER_NAME = 'planner-1'
const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000

export class Consumer {
  private running = false

  constructor(
    private readonly redis: Redis,
    private readonly onMessage: (msg: ManagerToPlannerMessage) => Promise<void>,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms))
  ) {}

  async start(sessionId: string): Promise<void> {
    const stream = `manager:to-planner:${sessionId}`

    try {
      await this.redis.xgroup('CREATE', stream, CONSUMER_GROUP, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }

    this.running = true
    let retryDelay = INITIAL_RETRY_DELAY_MS

    while (this.running) {
      try {
        const results = await this.redis.xreadgroup(
          'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
          'COUNT', '1', 'BLOCK', '1000',
          'STREAMS', stream, '>'
        ) as unknown as [string, [string, string[]][]][] | null

        retryDelay = INITIAL_RETRY_DELAY_MS
        if (results && results.length > 0) {
          await this.processMessages(stream, results[0][1])
        }
      } catch (e: unknown) {
        if (!this.running) return
        console.error(`[Consumer] xreadgroup error, retrying in ${retryDelay}ms:`, e)
        await this.sleep(retryDelay)
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
      }
    }
  }

  private async processMessages(stream: string, messages: [string, string[]][]) {
    for (const [msgId, fields] of messages) {
      const dataIdx = fields.indexOf('data')
      if (dataIdx === -1) continue

      const parsed = ManagerToPlannerMessageSchema.safeParse(
        JSON.parse(fields[dataIdx + 1])
      )
      if (!parsed.success) {
        console.error('[Consumer] invalid message, skipping:', parsed.error.issues)
        await this.redis.xack(stream, CONSUMER_GROUP, msgId)
        continue
      }

      await this.onMessage(parsed.data)
      await this.redis.xack(stream, CONSUMER_GROUP, msgId)
    }
  }

  stop(): void {
    this.running = false
  }
}
