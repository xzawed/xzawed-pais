import { z } from 'zod'
import { RedisEventBus, routeToDlq } from '@xzawed/agent-streams'
import type { StreamConsumerPort } from '@xzawed/agent-streams'
import type { OrchestratorToManagerMessage } from '../types/streams.js'
import { UserContextSchema, AbsoluteUserContextSchema } from '../types/user-context.js'
import { createRedisClient, releaseRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `orchestrator:to-manager:${sessionId}`
const GROUP = 'manager-consumers'

export type MessageHandler = (msg: OrchestratorToManagerMessage) => Promise<void>

const TaskRequestSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.literal('task_request'),
  payload: z.object({
    intent: z.string(),
    context: z.record(z.unknown()),
    priority: z.enum(['normal', 'high']),
    userContext: UserContextSchema.optional(),
    // 전역 게이트 모드(설정 UI) — Manager가 세션 기본 승인 모드로 적용. 누락 시 기본(manual).
    gateMode: z.enum(['manual', 'auto']).optional(),
  }),
})

const InfoResponseSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.literal('info_response'),
  payload: z.object({ answer: z.string() }),
})

const AbortSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.literal('abort'),
  payload: z.record(z.never()),
})

const DecomposeRequestSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.literal('decompose_request'),
  payload: z.object({
    intent: z.string().min(1),
    // P4a-2: 워크스페이스 컨텍스트(additive optional) — 분해→그래프 영속→실행 워커 주입.
    // 자율 실행 경로라 절대경로 강제(상대경로는 Zod 단계 거부 — false-success 방지).
    userContext: AbsoluteUserContextSchema.optional(),
  }),
})

export const OrchestratorToManagerMessageSchema = z.union([
  TaskRequestSchema,
  InfoResponseSchema,
  AbortSchema,
  DecomposeRequestSchema,
])

export class StreamConsumer {
  private running = false
  private _bus: StreamConsumerPort | null = null
  private _redis: import('ioredis').Redis | null = null

  constructor(private readonly redisUrl: string) {}

  /**
   * **세션마다 전용 연결.** 공유 클라이언트(`getRedisClient`)를 쓰면 세션 소비자 N 개가
   * 한 소켓에서 `XREADGROUP ... BLOCK 2000` 으로 경쟁하고, ioredis 는 명령을 직렬화하므로
   * 새 세션의 `XGROUP CREATE` 가 그 뒤에 줄을 선다.
   *
   * 실측(같은 스택, 세션 누적에 따라): 활성 0개일 때 **1ms** → 5개 4~9초 → 17개 **12초**
   * → 21개 **16~23초**. 그 창 동안 도착한 `task_request` 는 아래 `'0'` 이 없으면 유실된다.
   */
  private get bus(): StreamConsumerPort {
    this._redis ??= createRedisClient(this.redisUrl)
    this._bus ??= new RedisEventBus(this._redis)
    return this._bus
  }

  /**
   * **`'0'` 으로 만든다 — 생산자가 소비자보다 먼저 쓸 수 있는 스트림이기 때문이다.**
   *
   * Orchestrator 는 세션 개통 통지와 `task_request` 를 잇달아 발행하는데, Manager 가 그
   * 세션의 소비자를 세우는 것은 게이트웨이를 한 번 거친 뒤다. 기본값 `'$'` 는 그룹 생성
   * **이후** 메시지만 주므로, 그 사이에 도착한 첫 메시지가 영원히 전달되지 않는다 —
   * DLQ 도 로그도 에러도 없는 완전한 무음 유실이었다(실측 6/6, Grok 반증 3/3 재현).
   *
   * `'0'` 은 **그룹이 처음 만들어질 때만** 적용된다(BUSYGROUP 이면 무시). 즉 재시작 시
   * 기존 그룹의 위치를 되돌리지 않으므로 대량 재전달은 일어나지 않는다.
   */
  async ensureGroup(sessionId: string): Promise<void> {
    await this.bus.ensureGroup(streamKey(sessionId), GROUP, '0')
  }

  /** 구조적 결함=null(ack-skip), JSON/스키마 무효={poison}(DLQ), 유효={data,raw}. */
  private parseMessage(
    id: string,
    fields: string[],
  ): { data: OrchestratorToManagerMessage; raw: string } | { poison: string } | null {
    const dataIdx = fields.indexOf('data')
    if (dataIdx === -1) return null
    const rawStr = fields[dataIdx + 1]
    if (rawStr === undefined) return null
    let raw: unknown
    try {
      raw = JSON.parse(rawStr)
    } catch {
      console.error(`[StreamConsumer] JSON parse 실패 ${id} → DLQ(invalid_schema)`)
      return { poison: rawStr }
    }
    const parsed = OrchestratorToManagerMessageSchema.safeParse(raw)
    if (!parsed.success) {
      console.error(`[StreamConsumer] 스키마 무효 ${id} → DLQ(invalid_schema):`, parsed.error.issues)
      return { poison: rawStr }
    }
    return { data: parsed.data, raw: rawStr }
  }

  private async processEntry(
    id: string,
    fields: string[],
    sessionId: string,
    handler: MessageHandler,
  ): Promise<void> {
    const stream = streamKey(sessionId)
    const r = this.parseMessage(id, fields)
    if (r === null) { await this.bus.ack(stream, GROUP, [id]); return }
    if ('poison' in r) {
      await routeToDlq(this.bus, stream, r.poison, 'invalid_schema', 0)
      await this.bus.ack(stream, GROUP, [id]); return
    }
    try {
      await handler(r.data)
    } catch (err) {
      console.error(`[StreamConsumer] Handler error for message ${id} → DLQ(handler_failed):`, err)
      await routeToDlq(this.bus, stream, r.raw, 'handler_failed', 1, err)
    } finally {
      await this.bus.ack(stream, GROUP, [id])
    }
  }

  async start(sessionId: string, handler: MessageHandler): Promise<void> {
    await this.ensureGroup(sessionId)
    this.running = true
    const consumerId = `manager-${process.pid}`

    while (this.running) {
      try {
        const results = await this.bus.readGroup(
          streamKey(sessionId), GROUP, consumerId, { count: 10, blockMs: 2000 },
        )

        if (!results) continue

        for (const [, entries] of results) {
          for (const [id, fields] of entries) {
            await this.processEntry(id, fields, sessionId, handler)
          }
        }
      } catch (err) {
        if (!this.running) break
        if (err instanceof Error && err.message.includes('NOGROUP')) {
          // consumer group이 삭제된 경우 — 재생성 후 재시도
          await this.ensureGroup(sessionId)
          continue
        }
        console.error(`[StreamConsumer] xreadgroup error (will retry in 1s):`, err)
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }

  stop(): void {
    this.running = false
  }

  /**
   * 전용 연결을 닫는다. `stop()` 은 루프 탈출만 요청하므로 소켓은 이것으로 회수한다 —
   * 안 부르면 세션 수만큼 연결이 쌓인다. never-throw(정리 경로).
   */
  async close(): Promise<void> {
    this.running = false
    const r = this._redis
    this._redis = null
    this._bus = null
    if (r) await releaseRedisClient(r)
  }
}
