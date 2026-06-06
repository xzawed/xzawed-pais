import { z } from 'zod'
import { RedisEventBus } from '@xzawed/agent-streams'
import type { StreamConsumerPort } from '@xzawed/agent-streams'
import { getRedisClient } from './redis.client.js'

const GATEWAY_STREAM = 'orchestrator:to-manager:sessions'
const GROUP = 'manager-gateway'

export type SessionInitCallback = (sessionId: string) => void | Promise<void>

export class SessionGatewayConsumer {
  private running = false
  private _bus: StreamConsumerPort | null = null

  constructor(
    private readonly redisUrl: string,
    private readonly onSessionInit: SessionInitCallback,
  ) {}

  /** getRedisClient는 URL별 캐시 클라이언트 — bus도 1회 생성 후 재사용. */
  private get bus(): StreamConsumerPort {
    this._bus ??= new RedisEventBus(getRedisClient(this.redisUrl))
    return this._bus
  }

  async start(): Promise<void> {
    await this.bus.ensureGroup(GATEWAY_STREAM, GROUP)

    this.running = true
    const consumerId = `manager-gateway-${process.pid}`

    while (this.running) {
      try {
        const results = await this.bus.readGroup(
          GATEWAY_STREAM, GROUP, consumerId, { count: 10, blockMs: 2000 },
        )

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
              await this.bus.ack(GATEWAY_STREAM, GROUP, [msgId])
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
