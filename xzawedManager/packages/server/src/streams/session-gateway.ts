import { z } from 'zod'
import { RedisEventBus, routeToDlq } from '@xzawed/agent-streams'
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
            await this._processEntry(msgId, fields)
          }
        }
      } catch (err: unknown) {
        if (!this.running) break
        console.error('[SessionGateway] xreadgroup error, retrying in 1s:', err)
        await new Promise(r => setTimeout(r, 1_000))
      }
    }
  }

  private async _processEntry(msgId: string, fields: string[]): Promise<void> {
    try {
      const dataIdx = fields.indexOf('data')
      const rawStr = dataIdx === -1 ? undefined : fields[dataIdx + 1]
      if (rawStr === undefined) return  // 구조적 skip
      let parsed: { sessionId?: unknown }
      try {
        parsed = JSON.parse(rawStr) as { sessionId?: unknown }
      } catch {
        await routeToDlq(this.bus, GATEWAY_STREAM, rawStr, 'invalid_schema', 0)
        return
      }
      const sid = z.string().uuid().safeParse(parsed.sessionId)
      if (!sid.success) return  // 소프트 검증 skip(현재 동작 보존)
      try {
        await this.onSessionInit(sid.data)
      } catch (err) {
        await routeToDlq(this.bus, GATEWAY_STREAM, rawStr, 'handler_failed', 1, err)
      }
    } finally {
      await this.bus.ack(GATEWAY_STREAM, GROUP, [msgId])
    }
  }

  stop(): void {
    this.running = false
  }
}
