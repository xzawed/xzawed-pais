import type { Redis } from 'ioredis'
import type { ZodType } from 'zod'
import { RedisEventBus } from './event-bus.js'
import type { StreamConsumerPort } from './event-bus.js'
import { defaultDedupKey, idemKey, routeToDlq } from './dlq.js'

// DLQ 키·멱등 마커·기본 dedup 키는 dlq.ts가 단일출처(redrive 도구와 포맷 공유). 기존 import 경로 호환을 위해 재노출.
export { defaultDedupKey }

const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024 // 10 MiB
const PENDING_MIN_IDLE_MS = 5 * 60 * 1000  // 5분
const PENDING_CLAIM_COUNT = 10
const MAX_DELIVERIES_DEFAULT = 3
const RETRY_BASE_MS = 500
const RETRY_CAP_MS = 5_000
const IDEM_TTL_DEFAULT_SEC = 86_400 // 24h — 최대 재전달 창(XAUTOCLAIM 5분+outbox 폴링)보다 충분히 김

/** dedup 키 추출 옵션. enabled/ttlSec/key 모두 선택 — 미지정 시 env·기본 추출기로 폴백. */
export interface DedupOptions<TMessage> {
  enabled?: boolean
  ttlSec?: number
  key?: (msg: TMessage) => string | null
}

/** SHARED_IDEM_TTL_SEC를 양의 정수로 파싱. NaN/0/음수는 기본값(24h)으로 폴백. */
function parseIdemTtlSec(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : IDEM_TTL_DEFAULT_SEC
}

export class BaseConsumer<TMessage> {
  private running = false
  private readonly idemEnabled: boolean
  private readonly idemTtlSec: number
  private readonly dedupKeyFn: (msg: TMessage) => string | null
  /** 소비 전송 포트(P1c-2). 메시지 경로 Redis 스트림 명령을 위임. dedup set·close quit은 raw redis 유지. */
  private readonly bus: StreamConsumerPort

  constructor(
    private readonly redis: Redis,
    private readonly onMessage: (msg: TMessage) => Promise<void>,
    private readonly consumerGroup: string,
    private readonly consumerName: string,
    private readonly streamPrefix: string,
    private readonly schema: ZodType<TMessage>,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    private readonly ownsRedis: boolean = true,
    private readonly maxDeliveries: number = MAX_DELIVERIES_DEFAULT,
    dedup: DedupOptions<TMessage> = {},
  ) {
    this.idemEnabled = dedup.enabled ?? (process.env['SHARED_IDEMPOTENT_CONSUME'] !== 'false')
    // Math.max(1,·): 명시 ttlSec:0/음수도 최소 1로 클램프(`0 ?? x`는 0이라 env 가드를 우회 → SET EX 0은 Redis가 거부)
    this.idemTtlSec = Math.max(1, dedup.ttlSec ?? parseIdemTtlSec(process.env['SHARED_IDEM_TTL_SEC']))
    this.dedupKeyFn = dedup.key ?? (defaultDedupKey as (msg: TMessage) => string | null)
    this.bus = new RedisEventBus(this.redis)
  }

  async start(sessionId: string): Promise<void> {
    if (this.running) throw new Error('BaseConsumer is already running')
    const stream = `${this.streamPrefix}:${sessionId}`
    await this.ensureGroup(stream)

    this.running = true
    await this.claimPendingMessages(stream)

    let retryDelay = INITIAL_RETRY_DELAY_MS

    while (this.running) {
      retryDelay = await this.readOnce(stream, retryDelay)
    }
  }

  /**
   * XAUTOCLAIM으로 5분 이상 미처리 메시지를 재획득해 처리한다.
   * Redis 6.2+ 미만이거나 XAUTOCLAIM을 지원하지 않으면 무시한다.
   */
  private async claimPendingMessages(stream: string): Promise<void> {
    try {
      const rawResult = await this.bus.autoclaim(
        stream, this.consumerGroup, this.consumerName,
        { minIdleMs: PENDING_MIN_IDLE_MS, count: PENDING_CLAIM_COUNT },
      )

      if (!Array.isArray(rawResult) || !Array.isArray(rawResult[1])) return
      const messages = rawResult[1] as [string, string[]][]
      if (messages.length > 0) {
        await this.processMessages(stream, messages)
      }
    } catch {
      // XAUTOCLAIM 미지원 Redis 버전이거나 스트림이 없는 경우 무시
    }
  }

  private async ensureGroup(stream: string): Promise<void> {
    await this.bus.ensureGroup(stream, this.consumerGroup)
  }

  private async readOnce(stream: string, retryDelay: number): Promise<number> {
    try {
      const results = await this.bus.readGroup(
        stream, this.consumerGroup, this.consumerName, { count: 10, blockMs: 1000 },
      )

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
    // xack 대상 ID를 수집해 처리 후 pipeline으로 일괄 확인. handleMessage는 throw하지 않아 배치 비차단.
    const toAck: string[] = []
    try {
      for (const [msgId, fields] of messages) {
        await this.handleMessage(stream, fields)
        toAck.push(msgId)
      }
    } finally {
      if (toAck.length > 0) {
        await this.ackAll(stream, toAck)
      }
    }
  }

  /** 단일 메시지 처리: parse→retry→DLQ. 절대 throw하지 않는다(배치 비차단·PEL 누수 0). */
  private async handleMessage(stream: string, fields: string[]): Promise<void> {
    try {
      const parsed = await this.parseOrDlq(stream, fields)
      if (parsed === null) return
      if (await this.isDuplicate(stream, parsed.data)) return // 중복 delivery → skip(상위에서 ack)
      await this.dispatchWithRetry(stream, parsed.raw, parsed.data)
    } catch (err) {
      // 최종 안전망 — 내부의 어떤 예외(error 코어션·주입 sleep reject 등)도 배치를 끊지 않는다(never-throws 계약).
      console.error('[Consumer] handleMessage 예기치 못한 예외 — ack하고 계속:', err)
    }
  }

  /**
   * fields에서 raw를 추출·검증한다. 구조적 결함(data 없음·undefined·과대)은 ack+skip(null 반환),
   * JSON/스키마 무효는 invalid_schema로 DLQ 후 null 반환, 유효하면 {raw, data} 반환.
   */
  private async parseOrDlq(stream: string, fields: string[]): Promise<{ raw: string; data: TMessage } | null> {
    const dataIdx = fields.indexOf('data')
    if (dataIdx === -1) { console.error('[Consumer] missing data field, skipping'); return null }
    const raw = fields[dataIdx + 1]
    if (raw === undefined) { console.error('[Consumer] data field has no value, skipping'); return null }
    if (Buffer.byteLength(raw, 'utf8') > MAX_MESSAGE_BYTES) { console.error('[Consumer] message too large, skipping'); return null }

    let parsed: ReturnType<typeof this.schema.safeParse>
    try {
      parsed = this.schema.safeParse(JSON.parse(raw))
    } catch {
      console.error('[Consumer] JSON parse error → DLQ')
      await this.routeToDlq(stream, raw, 'invalid_schema', 0)
      return null
    }
    if (!parsed.success) {
      console.error('[Consumer] invalid message → DLQ:', parsed.error.issues)
      await this.routeToDlq(stream, raw, 'invalid_schema', 0)
      return null
    }
    return { raw, data: parsed.data }
  }

  /**
   * delivery당 1회 SETNX로 dedup 키를 claim. 이미 존재하면 true(중복 → skip).
   * 비활성·키 없음·SETNX 오류(fail-open)는 false(처리 계속) — dedup 장애가 처리를 막지 않는다(never-throws).
   * delivery당 1회만 호출하므로 dispatchWithRetry의 P1a 인-프로세스 재시도는 dedup에 막히지 않는다.
   */
  private async isDuplicate(stream: string, data: TMessage): Promise<boolean> {
    if (!this.idemEnabled) return false
    const key = this.dedupKeyFn(data)
    if (key === null) return false
    try {
      const res = await this.redis.set(idemKey(stream, key), '1', 'EX', this.idemTtlSec, 'NX')
      return res === null // ioredis: 'OK'면 신규(set됨), null이면 이미 존재(중복)
    } catch (err) {
      console.error('[Consumer] dedup SETNX 실패 — fail-open(처리 계속):', err)
      return false
    }
  }

  /** 유효 메시지를 maxDeliveries회까지 백오프 재시도. 소진 시 handler_failed로 DLQ. */
  private async dispatchWithRetry(stream: string, raw: string, data: TMessage): Promise<void> {
    const max = Math.max(1, this.maxDeliveries) // 0·음수 구성에서도 최소 1회 시도 보장(손실 방지)
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        await this.onMessage(data)
        return
      } catch (err) {
        if (attempt >= max) {
          console.error(`[Consumer] 핸들러 ${attempt}회 실패 → DLQ:`, err)
          await this.routeToDlq(stream, raw, 'handler_failed', attempt, err)
          return
        }
        await this.sleep(Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS))
      }
    }
  }

  /** poison 메시지를 {stream}:dlq로 격리한다 — DLQ 쓰기는 dlq.ts routeToDlq 단일출처에 위임. */
  private async routeToDlq(
    stream: string, raw: string, reason: 'handler_failed' | 'invalid_schema',
    attempts: number, error?: unknown,
  ): Promise<void> {
    await routeToDlq(this.bus, stream, raw, reason, attempts, error)
  }

  /** 수집된 메시지 ID를 ack한다(pipeline 배치 + 폴백은 포트가 담당). */
  private async ackAll(stream: string, ids: string[]): Promise<void> {
    await this.bus.ack(stream, this.consumerGroup, ids)
  }

  stop(): void {
    this.running = false
  }

  async close(): Promise<void> {
    this.running = false
    if (this.ownsRedis) {
      await this.redis.quit()
    }
  }
}
