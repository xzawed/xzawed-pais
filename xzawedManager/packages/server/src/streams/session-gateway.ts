import { z } from 'zod'
import { getRedisClient } from './redis.client.js'

const GATEWAY_STREAM = 'orchestrator:to-manager:sessions'
const GROUP = 'manager-gateway'

export type SessionInitCallback = (sessionId: string) => void | Promise<void>

export class SessionGatewayConsumer {
  private running = false

  constructor(
    private readonly redisUrl: string,
    private readonly onSessionInit: SessionInitCallback,
  ) {}

  async start(): Promise<void> {
    const redis = getRedisClient(this.redisUrl)
    try {
      await redis.xgroup('CREATE', GATEWAY_STREAM, GROUP, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }

    this.running = true
    const consumerId = `manager-gateway-${process.pid}`

    while (this.running) {
      try {
        const results = await redis.xreadgroup(
          'GROUP', GROUP, consumerId,
          'COUNT', '10', 'BLOCK', '2000',
          'STREAMS', GATEWAY_STREAM, '>',
        ) as [string, [string, string[]][]][] | null

        if (!results) continue

        for (const [, entries] of results) {
          for (const [msgId, fields] of entries) {
            try {
              const dataIdx = fields.indexOf('data')
              if (dataIdx !== -1) {
                const raw = fields[dataIdx + 1]
                if (raw !== undefined) {
                  const parsed = JSON.parse(raw) as { sessionId?: unknown }
                  const sessionIdResult = z.string().uuid().safeParse(parsed.sessionId)
                  if (sessionIdResult.success) {
                    await this.onSessionInit(sessionIdResult.data)
                  }
                }
              }
            } catch {
              // skip malformed messages
            } finally {
              await redis.xack(GATEWAY_STREAM, GROUP, msgId)
            }
          }
        }
      } catch (err: unknown) {
        if (!this.running) break
        console.error('[SessionGateway] xreadgroup error, retrying in 1s:', err)
        await new Promise(r => setTimeout(r, 1_000))
      }
    }
  }

  stop(): void {
    this.running = false
  }
}
