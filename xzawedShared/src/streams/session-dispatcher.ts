import type { Redis } from 'ioredis'

const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000

export interface ConsumerLike {
  start(sessionId: string): Promise<void>
  stop(): void
  close?(): Promise<void>
}

export class SessionDispatcher {
  private running = false
  private readonly activeConsumers = new Map<string, ConsumerLike>()
  private readonly MAX_ACTIVE_CONSUMERS = 1000

  constructor(
    private readonly gatewayRedis: Redis,
    private readonly gatewayStream: string,
    private readonly group: string,
    private readonly consumerFactory: (sessionId: string) => ConsumerLike,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise(r => setTimeout(r, ms)),
  ) {}

  async start(): Promise<void> {
    try {
      await this.gatewayRedis.xgroup('CREATE', this.gatewayStream, this.group, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }

    this.running = true
    const consumerId = `${this.group}-${process.pid}`
    let retryDelay = INITIAL_RETRY_DELAY_MS

    while (this.running) {
      try {
        const results = await this.gatewayRedis.xreadgroup(
          'GROUP', this.group, consumerId,
          'COUNT', '10', 'BLOCK', '2000',
          'STREAMS', this.gatewayStream, '>',
        ) as [string, [string, string[]][]][] | null

        if (!results) {
          retryDelay = INITIAL_RETRY_DELAY_MS
          // yield to event loop so stop() can be observed between iterations
          await this.sleep(0)
          continue
        }

        for (const [, entries] of results) {
          for (const [msgId, fields] of entries) {
            try {
              this.handleGatewayEntry(fields)
            } catch (err) {
              console.error('[SessionDispatcher] entry error:', err)
            } finally {
              await this.gatewayRedis.xack(this.gatewayStream, this.group, msgId)
            }
          }
        }
        retryDelay = INITIAL_RETRY_DELAY_MS
      } catch (err: unknown) {
        if (!this.running) break
        console.error(`[SessionDispatcher] xreadgroup error, retrying in ${retryDelay}ms:`, err)
        await this.sleep(retryDelay)
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
      }
    }
  }

  private handleGatewayEntry(fields: string[]): void {
    const dataIdx = fields.indexOf('data')
    if (dataIdx === -1) return
    const raw = fields[dataIdx + 1]
    if (raw === undefined) return

    let sessionId: string | undefined
    try {
      const parsed = JSON.parse(raw) as { sessionId?: unknown }
      if (typeof parsed.sessionId === 'string') {
        sessionId = parsed.sessionId
      }
    } catch {
      return
    }

    if (!sessionId || this.activeConsumers.has(sessionId)) return

    if (this.activeConsumers.size >= this.MAX_ACTIVE_CONSUMERS) {
      console.warn(`[SessionDispatcher] max consumers (${this.MAX_ACTIVE_CONSUMERS}) reached, ignoring session ${sessionId}`)
      return
    }

    const consumer = this.consumerFactory(sessionId)
    this.activeConsumers.set(sessionId, consumer)

    void consumer.start(sessionId).catch((err: unknown) => {
      console.error(`[SessionDispatcher] consumer error for ${sessionId}:`, err)
    })
  }

  stop(): void {
    this.running = false
    for (const consumer of this.activeConsumers.values()) {
      consumer.stop()
      void consumer.close?.()
    }
    this.activeConsumers.clear()
  }

  async close(): Promise<void> {
    this.running = false
    const closePromises: Promise<void>[] = []
    for (const consumer of this.activeConsumers.values()) {
      consumer.stop()
      if (consumer.close) {
        closePromises.push(consumer.close())
      }
    }
    this.activeConsumers.clear()
    await Promise.all(closePromises)
  }
}
