import { z } from 'zod'
import { RedisEventBus } from '@xzawed/agent-streams'
import type { StreamConsumerPort } from '@xzawed/agent-streams'
import type { OrchestratorToManagerMessage } from '../types/streams.js'
import { UserContextSchema, AbsoluteUserContextSchema } from '../types/user-context.js'
import { getRedisClient } from './redis.client.js'

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

  constructor(private readonly redisUrl: string) {}

  /** getRedisClient는 URL별 캐시 클라이언트 — bus도 1회 생성 후 재사용. */
  private get bus(): StreamConsumerPort {
    this._bus ??= new RedisEventBus(getRedisClient(this.redisUrl))
    return this._bus
  }

  async ensureGroup(sessionId: string): Promise<void> {
    await this.bus.ensureGroup(streamKey(sessionId), GROUP)
  }

  private parseMessage(
    id: string,
    fields: string[],
  ): OrchestratorToManagerMessage | null {
    const dataIdx = fields.indexOf('data')
    if (dataIdx === -1) return null
    const rawStr = fields[dataIdx + 1]
    if (rawStr === undefined) return null
    try {
      const raw: unknown = JSON.parse(rawStr)
      const parsed = OrchestratorToManagerMessageSchema.safeParse(raw)
      if (!parsed.success) {
        console.error(
          `[StreamConsumer] Invalid message schema ${id} — ACKing to skip:`,
          parsed.error.issues,
        )
        return null
      }
      return parsed.data
    } catch {
      console.error(`[StreamConsumer] Failed to parse message ${id} — ACKing to skip`)
      return null
    }
  }

  private async processEntry(
    id: string,
    fields: string[],
    sessionId: string,
    handler: MessageHandler,
  ): Promise<void> {
    const msg = this.parseMessage(id, fields)
    if (!msg) {
      await this.bus.ack(streamKey(sessionId), GROUP, [id])
      return
    }
    try {
      await handler(msg)
    } catch (err) {
      console.error(`[StreamConsumer] Handler error for message ${id}:`, err)
    } finally {
      await this.bus.ack(streamKey(sessionId), GROUP, [id])
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
}
