import { z } from 'zod'

/**
 * DLQ(데드레터 큐) 계약·재처리 도구.
 *
 * BaseConsumer가 poison 메시지를 `{stream}:dlq`로 격리하는 쓰기 경로(`routeToDlq`)와
 * 멱등 마커(`idem:{stream}:{key}`)의 **단일출처**다. base-consumer.ts가 이 헬퍼를 재사용해
 * 키 포맷이 드리프트하지 않게 한다(이 모듈은 base-consumer를 import하지 않음 — 순환 회피).
 *
 * `redriveDlq`는 격리된 메시지를 원 스트림으로 되돌리는 운영 도구(P1 운영 잔여 해소):
 * 멱등 마커를 먼저 삭제(재발행본이 dedup-skip되지 않도록) → 원본을 재발행 → DLQ에서 제거.
 */

const DEFAULT_REDRIVE_COUNT = 100

/** DLQ 스트림 키: `{stream}:dlq`. routeToDlq 발행 대상과 동일해야 한다. */
export function dlqStreamKey(stream: string): string {
  return `${stream}:dlq`
}

/** 멱등 마커 키: `idem:{stream}:{key}`. isDuplicate의 SETNX 키와 동일해야 한다. */
export function idemKey(stream: string, key: string): string {
  return `idem:${stream}:${key}`
}

/**
 * 기본 dedup 키: envelope.idempotencyKey ?? messageId. 둘 다 없으면 null(해당 메시지 dedup 건너뜀).
 * isDuplicate·redrive 양쪽이 같은 키를 산출해야 마커 삭제가 유효하다.
 */
export function defaultDedupKey(msg: unknown): string | null {
  const m = msg as { messageId?: unknown; envelope?: { idempotencyKey?: unknown } }
  const idem = m.envelope?.idempotencyKey
  if (typeof idem === 'string' && idem.length > 0) return idem
  if (typeof m.messageId === 'string' && m.messageId.length > 0) return m.messageId
  return null
}

/** DLQ 격리 사유. routeToDlq가 발행하는 두 종류. */
export const DlqReasonSchema = z.enum(['handler_failed', 'invalid_schema'])
export type DlqReason = z.infer<typeof DlqReasonSchema>

/** routeToDlq가 `{stream}:dlq`에 발행하는 봉투 스키마(redrive가 파싱). */
export const DlqMessageSchema = z.object({
  /** 원본 메시지의 raw JSON 문자열(원 스트림 'data' 필드 값). */
  original: z.string(),
  reason: DlqReasonSchema,
  attempts: z.number().int().nonnegative(),
  error: z.string().optional(),
  failedAt: z.number(),
  sourceStream: z.string(),
})
export type DlqMessage = z.infer<typeof DlqMessageSchema>

/** DLQ 발행에 필요한 최소 publisher 인터페이스(EventBus/StreamConsumerPort 구조 충족·테스트 주입 용이). */
export interface DlqPublisher {
  publish(stream: string, message: unknown, opts?: { maxlen?: number }): Promise<unknown>
}

/** DLQ approximate MAXLEN(무한 증가 방지). BaseConsumer·인바운드 소비자 공유. */
export const DLQ_MAXLEN = 1000

/**
 * poison 메시지를 `{stream}:dlq`로 격리한다(DlqMessage 봉투 발행) — DLQ 쓰기 경로 단일출처.
 * 페이로드 구성·발행 실패는 모두 경고 후 무시(배치 비차단·never-throw) — 격리 best-effort.
 * error 코어션도 try 안에서(병리적 throwing getter가 계약을 깨지 않도록).
 */
export async function routeToDlq(
  publisher: DlqPublisher,
  stream: string,
  raw: string,
  reason: DlqReason,
  attempts: number,
  error?: unknown,
): Promise<void> {
  try {
    const dlqMessage = {
      original: raw, reason, attempts,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
      failedAt: Date.now(), sourceStream: stream,
    }
    await publisher.publish(dlqStreamKey(stream), dlqMessage, { maxlen: DLQ_MAXLEN })
  } catch (e) {
    console.error(`[dlq] DLQ 발행 실패(${dlqStreamKey(stream)}) — 메시지 격리 실패:`, e)
  }
}

/** redrive가 사용하는 Redis 명령의 최소 구조적 인터페이스(ioredis Redis 호환·테스트 주입 용이). */
export interface DlqRedis {
  xrange(
    key: string,
    start: string,
    end: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<Array<[string, string[]]>>
  xadd(key: string, id: string, field: string, value: string): Promise<string | null>
  xdel(key: string, ...ids: string[]): Promise<number>
  del(...keys: string[]): Promise<number>
}

export interface RedriveOptions {
  /** 한 번에 재처리할 최대 엔트리 수(기본 100). DLQ 폭주 시 배치 제어. */
  count?: number
  /** 이 reason의 엔트리만 재처리(미지정 시 전부). invalid_schema 무한 재발행 루프 회피용. */
  reason?: DlqReason
  /** dedup 키 추출기(소비자와 일치해야 마커 삭제가 유효). 기본 defaultDedupKey. */
  dedupKey?: (msg: unknown) => string | null
}

export interface RedriveResult {
  /** DLQ에서 읽은 엔트리 수. */
  read: number
  /** 원 스트림으로 재발행한(=DLQ에서 제거한) 엔트리 수. */
  republished: number
  /** 파싱 불가·재발행 실패로 건너뛴(=DLQ에 보존한) 엔트리 수. */
  skipped: number
}

/** DLQ 엔트리 fields(`['data', json, ...]`)에서 봉투를 추출·검증한다. 실패면 null. */
function parseDlqEntry(fields: string[]): DlqMessage | null {
  const dataIdx = fields.indexOf('data')
  if (dataIdx === -1) return null
  const raw = fields[dataIdx + 1]
  if (raw === undefined) return null
  try {
    const parsed = DlqMessageSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** 원본 raw에서 dedup 키를 안전하게 산출(파싱 불가면 null → 마커 삭제 건너뜀). */
function safeDedupKey(original: string, fn: (msg: unknown) => string | null): string | null {
  try {
    return fn(JSON.parse(original))
  } catch {
    return null
  }
}

/**
 * `{sourceStream}:dlq`에 격리된 메시지를 원 스트림으로 되돌린다.
 *
 * 각 엔트리: 봉투 파싱 → (reason 필터) → 멱등 마커 삭제(재발행본이 dedup-skip되지 않도록 **재발행 전**)
 * → 원본을 원 스트림에 재발행(소비자 그룹이 XREADGROUP으로 픽업) → DLQ에서 제거(재실행 시 이중 재발행 방지).
 *
 * 파싱 불가·엔트리별 실패는 skip(엔트리 보존)하고 배치를 계속한다(드레인 비차단). 재발행 후 XDEL 실패로
 * 엔트리가 남아도 소비자 멱등 소비가 이중 처리를 흡수한다(재발행본은 새 마커로 dedup).
 */
export async function redriveDlq(
  redis: DlqRedis,
  sourceStream: string,
  opts: RedriveOptions = {},
): Promise<RedriveResult> {
  const dlqStream = dlqStreamKey(sourceStream)
  const limit = opts.count ?? DEFAULT_REDRIVE_COUNT
  const dedupKeyFn = opts.dedupKey ?? defaultDedupKey

  const entries = await redis.xrange(dlqStream, '-', '+', 'COUNT', limit)
  let republished = 0
  let skipped = 0

  for (const [entryId, fields] of entries) {
    const msg = parseDlqEntry(fields)
    if (msg === null) {
      skipped++
      continue
    }
    if (opts.reason !== undefined && msg.reason !== opts.reason) continue // 필터 제외(미카운트·보존)

    try {
      const target = msg.sourceStream.length > 0 ? msg.sourceStream : sourceStream
      const key = safeDedupKey(msg.original, dedupKeyFn)
      if (key !== null) await redis.del(idemKey(target, key)) // 재발행 전 마커 삭제
      await redis.xadd(target, '*', 'data', msg.original)
      await redis.xdel(dlqStream, entryId)
      republished++
    } catch {
      skipped++ // 엔트리별 실패는 보존·계속(다음 운영 재시도가 이어서 드레인)
    }
  }

  return { read: entries.length, republished, skipped }
}
