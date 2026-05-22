import type { Redis } from 'ioredis'
import type { ZodType } from 'zod'

const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024 // 10 MiB

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
    await this.ensureGroup(stream)

    this.running = true
    let retryDelay = INITIAL_RETRY_DELAY_MS

    while (this.running) {
      retryDelay = await this.readOnce(stream, retryDelay)
    }
  }

  private async ensureGroup(stream: string): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', stream, this.consumerGroup, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }
  }

  private async readOnce(stream: string, retryDelay: number): Promise<number> {
    try {
      const results = await this.redis.xreadgroup(
        'GROUP', this.consumerGroup, this.consumerName,
        'COUNT', '1', 'BLOCK', '1000',
        'STREAMS', stream, '>',
      ) as unknown as [string, [string, string[]][]][] | null

      if (results && results.length > 0) {
        await this.processMessages(stream, results[0][1])
      }
      return INITIAL_RETRY_DELAY_MS
    } catch (e: unknown) {
      return this.handleReadError(stream, retryDelay, e)
    }
  }

  private async handleReadError(stream: string, retryDelay: number, e: unknown): Promise<number> {
    if (!this.running) return retryDelay
    if (e instanceof Error && e.message.includes('NOGROUP')) {
      await this.ensureGroup(stream)
      return INITIAL_RETRY_DELAY_MS
    }
    console.error(`[Consumer] xreadgroup error, retrying in ${retryDelay}ms:`, e)
    await this.sleep(retryDelay)
    return Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
  }

  private async processMessages(stream: string, messages: [string, string[]][]) {
    for (const [msgId, fields] of messages) {
      const dataIdx = fields.indexOf('data')
      if (dataIdx === -1) {
        console.error('[Consumer] missing data field, skipping')
        await this.redis.xack(stream, this.consumerGroup, msgId)
        continue
      }

      const raw = fields[dataIdx + 1]
      if (raw === undefined) {
        console.error('[Consumer] data field has no value, skipping')
        await this.redis.xack(stream, this.consumerGroup, msgId)
        continue
      }

      if (Buffer.byteLength(raw, 'utf8') > MAX_MESSAGE_BYTES) {
        console.error('[Consumer] message too large, skipping')
        await this.redis.xack(stream, this.consumerGroup, msgId)
        continue
      }

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
