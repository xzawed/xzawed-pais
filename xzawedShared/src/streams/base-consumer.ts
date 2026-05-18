import type { Redis } from 'ioredis'
import type { ZodType } from 'zod'

const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000

export class BaseConsumer<TMessage> {
  private running = false

  constructor(
    private readonly redis: Redis,
    private readonly onMessage: (msg: TMessage) => Promise<void>,
    private readonly consumerGroup: string,
    private readonly consumerName: string,
    private readonly streamPrefix: string,
    private readonly schema: ZodType<TMessage>,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async start(sessionId: string): Promise<void> {
    const stream = `${this.streamPrefix}:${sessionId}`

    try {
      await this.redis.xgroup('CREATE', stream, this.consumerGroup, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }

    this.running = true
    let retryDelay = INITIAL_RETRY_DELAY_MS

    while (this.running) {
      try {
        const results = await this.redis.xreadgroup(
          'GROUP', this.consumerGroup, this.consumerName,
          'COUNT', '1', 'BLOCK', '1000',
          'STREAMS', stream, '>',
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

      const raw = fields[dataIdx + 1]
      if (raw === undefined) continue

      let parsed: ReturnType<typeof this.schema.safeParse>
      try {
        parsed = this.schema.safeParse(JSON.parse(raw))
      } catch {
        console.error('[Consumer] JSON parse error, skipping')
        await this.redis.xack(stream, this.consumerGroup, msgId)
        continue
      }
      if (!parsed.success) {
        console.error('[Consumer] invalid message, skipping:', parsed.error.issues)
        await this.redis.xack(stream, this.consumerGroup, msgId)
        continue
      }

      try {
        await this.onMessage(parsed.data)
      } finally {
        await this.redis.xack(stream, this.consumerGroup, msgId)
      }
    }
  }

  stop(): void {
    this.running = false
  }
}
