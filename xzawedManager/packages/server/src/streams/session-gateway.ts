import { z } from 'zod'
import { RedisEventBus, routeToDlq } from '@xzawed/agent-streams'
import type { StreamConsumerPort } from '@xzawed/agent-streams'
import { createRedisClient } from './redis.client.js'

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

  /**
   * **전용 연결.** 이 소비자는 게이트웨이 스트림을 `BLOCK 2000` 으로 붙잡는다 — 공유
   * 클라이언트를 쓰면 같은 소켓의 다른 명령(세션 소비자의 XGROUP CREATE 등)이 그 뒤에 줄 선다.
   * `closeRedisClients` 가 종료 시 함께 quit 한다(수명이 프로세스와 같아 개별 회수 불필요).
   */
  private get bus(): StreamConsumerPort {
    this._bus ??= new RedisEventBus(createRedisClient(this.redisUrl))
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
      if (rawStr === undefined) {
        // data 필드가 없으면 DLQ에 실을 페이로드 자체가 없다 — shared BaseConsumer와 같은
        // 처리(로그 후 ack+skip)를 하되, 무음으로 사라지지는 않게 한다.
        console.error("[SessionGateway] data 필드 없음 — ack 후 skip:", msgId)
        return
      }
      let parsed: { sessionId?: unknown }
      try {
        parsed = JSON.parse(rawStr) as { sessionId?: unknown }
      } catch {
        await routeToDlq(this.bus, GATEWAY_STREAM, rawStr, 'invalid_schema', 0)
        return
      }
      const sid = z.string().uuid().safeParse(parsed.sessionId)
      if (!sid.success) {
        // 유일한 생산자(Orchestrator publishSessionGateway)가 UUID v4를 강제하고 위반 시
        // throw하므로, 여기 도달했다는 것은 손상이나 주입이다. 바로 위 JSON 무효 분기와
        // 같이 DLQ로 격리한다 — 페이로드가 있으므로 무음 skip할 이유가 없다(M8).
        await routeToDlq(this.bus, GATEWAY_STREAM, rawStr, "invalid_schema", 0)
        return
      }
      try {
        await this.onSessionInit(sid.data)
      } catch (err) {
        await routeToDlq(this.bus, GATEWAY_STREAM, rawStr, 'handler_failed', 1, err)
      }
    } finally {
      await this.bus.ack(GATEWAY_STREAM, GROUP, [msgId])
    }
  }

  /**
   * 소비 루프가 실제로 도는가. readiness 프로브가 쓴다.
   *
   * `ensureGroup` 이 이 루프 **밖**이라 기동 시점에 Redis 가 죽어 있으면 `start()` 가
   * reject 되고 `running` 은 false 로 남는다. 그때도 ioredis 재연결은 계속되므로
   * `ping()` 은 나중에 PONG 을 준다 — 그 상태를 밖에서 보는 유일한 신호다.
   */
  isRunning(): boolean {
    return this.running
  }

  stop(): void {
    this.running = false
  }
}
