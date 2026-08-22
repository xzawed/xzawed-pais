import { z } from 'zod'
import type { ManagerToOrchestratorMessage } from '@xzawed/shared'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `manager:to-orchestrator:${sessionId}`
const GROUP = 'orchestrator-consumers'

// 소비 루프 재시도 백오프. shared BaseConsumer·Manager StreamConsumer와 같은 의미론.
const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
// NOGROUP 연속 즉시복구 상한. 초과 시 일반 백오프로 강등(즉시재시도 무한루프 차단).
const MAX_NOGROUP_RECOVERIES = 3

const ManagerToOrchestratorMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['status_update', 'info_request', 'task_complete', 'error', 'knowledge_changed']),
  payload: z.object({
    agentId: z.string(),
    content: z.string(),
    uiSpec: z.unknown().optional(),
    approval: z.object({
      stage: z.string(),
      summary: z.string(),
      mode: z.literal('manual'),
    }).optional(),
    // knowledge_changed 대상 프로젝트(위키 실시간 갱신) — 빈 문자열은 거부(방어심층).
    projectId: z.string().min(1).optional(),
    // G5 고객 비용 가시성: 세션 누적 비용(USD)·토큰. status_update가 실어 보낸다(additive).
    costUsd: z.number().optional(),
    tokensUsed: z.number().optional(),
  }),
})

export type MessageHandler = (msg: ManagerToOrchestratorMessage) => Promise<void>

type RedisEntry = [string, string[]]
type RedisResult = [string, RedisEntry[]][]

function parseRedisEntry(fields: string[]): ManagerToOrchestratorMessage | null {
  const dataIdx = fields.indexOf('data')
  if (dataIdx === -1) return null
  const raw = fields[dataIdx + 1]
  if (raw === undefined) return null
  try {
    const parsed = ManagerToOrchestratorMessageSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      console.error('[StreamConsumer] invalid message, skipping:', parsed.error.issues)
      return null
    }
    return parsed.data as ManagerToOrchestratorMessage
  } catch (err: unknown) {
    console.error('[StreamConsumer] JSON parse error, skipping:', err)
    return null
  }
}

async function processEntries(
  entries: RedisEntry[],
  handler: MessageHandler,
  ack: (id: string) => Promise<unknown>,
): Promise<void> {
  for (const [id, fields] of entries) {
    const msg = parseRedisEntry(fields)
    if (msg === null) {
      await ack(id)
      continue
    }
    try {
      await handler(msg)
    } finally {
      await ack(id)
    }
  }
}

export class StreamConsumer {
  private running = false
  private nogroupRecoveries = 0
  private readonly redisUrl: string

  constructor(
    redisUrl: string,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    this.redisUrl = redisUrl
  }

  async ensureGroup(sessionId: string): Promise<void> {
    const redis = getRedisClient(this.redisUrl)
    try {
      await redis.xgroup('CREATE', streamKey(sessionId), GROUP, '$', 'MKSTREAM')
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err
    }
  }

  async start(sessionId: string, handler: MessageHandler): Promise<void> {
    await this.ensureGroup(sessionId)
    this.running = true
    this.nogroupRecoveries = 0
    const redis = getRedisClient(this.redisUrl)
    const consumerId = `consumer-${process.pid}-${sessionId}`
    const ack = (id: string) => redis.xack(streamKey(sessionId), GROUP, id)
    let retryDelay = INITIAL_RETRY_DELAY_MS

    while (this.running) {
      let results: RedisResult | null = null
      try {
        results = await redis.xreadgroup(
          'GROUP', GROUP, consumerId,
          'COUNT', '10', 'BLOCK', '2000',
          'STREAMS', streamKey(sessionId), '>'
        ) as RedisResult | null
      } catch (err: unknown) {
        if (!this.running) return
        retryDelay = await this.handleReadError(sessionId, retryDelay, err)
        continue
      }

      retryDelay = INITIAL_RETRY_DELAY_MS
      this.nogroupRecoveries = 0
      if (!results) continue

      for (const [, entries] of results) {
        await processEntries(entries, handler, ack)
      }
    }
  }

  /**
   * 읽기 실패를 복구한다. 백오프 없이 continue하면 Redis 단절·NOGROUP에서
   * 타이트 루프가 되어 CPU를 점유하고 로그를 범람시킨다(maxRetriesPerRequest:3이라 즉시 reject).
   *
   * NOGROUP은 그룹 재생성으로 복구되므로 대기 없이 재시도하되, 재생성이 곧바로 다시 NOGROUP을
   * 부르는 병적 상태(외부에서 그룹을 반복 삭제)에서 무한 즉시재시도가 되지 않도록
   * 연속 복구를 MAX_NOGROUP_RECOVERIES회로 제한하고 그 뒤로는 일반 백오프에 합류시킨다.
   */
  private async handleReadError(sessionId: string, retryDelay: number, err: unknown): Promise<number> {
    if (err instanceof Error && err.message.includes('NOGROUP')) {
      if (this.nogroupRecoveries < MAX_NOGROUP_RECOVERIES) {
        this.nogroupRecoveries++
        console.error('[StreamConsumer] NOGROUP — 소비자 그룹 재생성 후 재시도')
        try {
          await this.ensureGroup(sessionId)
          return INITIAL_RETRY_DELAY_MS
        } catch (recreateErr: unknown) {
          console.error('[StreamConsumer] 그룹 재생성 실패:', recreateErr)
        }
      } else {
        console.error(`[StreamConsumer] NOGROUP 연속 ${MAX_NOGROUP_RECOVERIES}회 복구 실패 — 백오프로 전환`)
      }
    }
    console.error(`[StreamConsumer] xreadgroup error, retrying in ${retryDelay}ms:`, err)
    await this.sleep(retryDelay)
    return Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
  }

  stop(): void {
    this.running = false
  }
}
