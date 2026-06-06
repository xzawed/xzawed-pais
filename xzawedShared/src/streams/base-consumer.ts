import type { Redis } from 'ioredis'
import type { ZodType } from 'zod'

const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024 // 10 MiB
const PENDING_MIN_IDLE_MS = 5 * 60 * 1000  // 5분
const PENDING_CLAIM_COUNT = 10
const MAX_DELIVERIES_DEFAULT = 3
const RETRY_BASE_MS = 500
const RETRY_CAP_MS = 5_000
const DLQ_MAXLEN = 1_000 // DLQ 스트림 approximate 보존 상한(무한 증가 방지)

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
    private readonly ownsRedis: boolean = true,
    private readonly maxDeliveries: number = MAX_DELIVERIES_DEFAULT,
  ) {}

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
      const rawResult = await this.redis.xautoclaim(
        stream,
        this.consumerGroup,
        this.consumerName,
        PENDING_MIN_IDLE_MS,
        '0-0',
        'COUNT', String(PENDING_CLAIM_COUNT),
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
        'COUNT', '10', 'BLOCK', '1000',
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

  /** poison 메시지를 {stream}:dlq로 격리한다. 페이로드 구성·발행 실패 모두 경고 후 무시(배치 비차단). */
  private async routeToDlq(
    stream: string, raw: string, reason: 'handler_failed' | 'invalid_schema',
    attempts: number, error?: unknown,
  ): Promise<void> {
    try {
      // error 코어션도 try 안에서 — 병리적 thrown 값(throwing getter 등)이 계약을 깨지 않도록
      const payload = JSON.stringify({
        original: raw, reason, attempts,
        ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
        failedAt: Date.now(), sourceStream: stream,
      })
      // DLQ 무한 증가 방지 — approximate MAXLEN(소비자/재처리 도구는 P1 운영)
      await this.redis.xadd(`${stream}:dlq`, 'MAXLEN', '~', String(DLQ_MAXLEN), '*', 'data', payload)
    } catch (e) {
      console.error(`[Consumer] DLQ 발행 실패(${stream}:dlq) — 메시지 격리 실패:`, e)
    }
  }

  /**
   * 수집된 메시지 ID를 ack한다.
   * pipeline을 지원하는 클라이언트(실제 ioredis)는 일괄 처리로 Redis RTT를 최소화하고,
   * pipeline 미지원 클라이언트는 개별 xack로 폴백한다.
   */
  private async ackAll(stream: string, ids: string[]): Promise<void> {
    if (typeof this.redis.pipeline === 'function') {
      const pipeline = this.redis.pipeline()
      for (const id of ids) {
        pipeline.xack(stream, this.consumerGroup, id)
      }
      await pipeline.exec()
      return
    }
    for (const id of ids) {
      await this.redis.xack(stream, this.consumerGroup, id)
    }
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
