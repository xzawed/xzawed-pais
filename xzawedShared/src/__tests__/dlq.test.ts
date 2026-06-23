import { describe, it, expect, vi } from 'vitest'
import {
  dlqStreamKey,
  idemKey,
  DlqMessageSchema,
  redriveDlq,
  routeToDlq,
  DLQ_MAXLEN,
  type DlqRedis,
} from '../streams/dlq.js'

/** routeToDlq가 발행하는 봉투 그대로의 DLQ 엔트리 'data' 문자열을 만든다. */
function dlqEntry(original: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    original: typeof original === 'string' ? original : JSON.stringify(original),
    reason: 'handler_failed',
    attempts: 3,
    failedAt: 1,
    sourceStream: 'manager:dispatched:main',
    ...extra,
  })
}

/** xrange/xadd/xdel/del을 기록하는 fake. xrange는 주입한 엔트리를 반환. */
function makeRedis(entries: Array<[string, string[]]> = []): DlqRedis & {
  xrange: ReturnType<typeof vi.fn>
  xadd: ReturnType<typeof vi.fn>
  xdel: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
} {
  return {
    xrange: vi.fn().mockResolvedValue(entries),
    xadd: vi.fn().mockResolvedValue('1-0'),
    xdel: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  }
}

describe('dlqStreamKey / idemKey', () => {
  it('dlqStreamKey는 소스 스트림에 :dlq를 붙인다(routeToDlq와 단일출처)', () => {
    expect(dlqStreamKey('manager:dispatched:main')).toBe('manager:dispatched:main:dlq')
  })
  it('idemKey는 idem:{stream}:{key} 형식이다(isDuplicate와 단일출처)', () => {
    expect(idemKey('prefix:sess-1', 'msg-1')).toBe('idem:prefix:sess-1:msg-1')
  })
})

describe('DlqMessageSchema', () => {
  it('routeToDlq 봉투를 파싱한다', () => {
    const parsed = DlqMessageSchema.safeParse(JSON.parse(dlqEntry({ a: 1 })))
    expect(parsed.success).toBe(true)
  })
  it('error는 선택 필드다(invalid_schema 봉투엔 없음)', () => {
    const parsed = DlqMessageSchema.safeParse(
      JSON.parse(dlqEntry('not-json', { reason: 'invalid_schema', attempts: 0 })),
    )
    expect(parsed.success).toBe(true)
  })
  it('미지 reason은 거부한다', () => {
    const parsed = DlqMessageSchema.safeParse(JSON.parse(dlqEntry({ a: 1 }, { reason: 'weird' })))
    expect(parsed.success).toBe(false)
  })
})

describe('redriveDlq', () => {
  const SOURCE = 'manager:dispatched:main'
  const DLQ = 'manager:dispatched:main:dlq'

  it('빈 DLQ면 아무것도 하지 않고 0을 보고한다', async () => {
    const redis = makeRedis([])
    const result = await redriveDlq(redis, SOURCE)
    expect(result).toEqual({ read: 0, republished: 0, skipped: 0 })
    expect(redis.xadd).not.toHaveBeenCalled()
    expect(redis.xdel).not.toHaveBeenCalled()
  })

  it('handler_failed 엔트리를 원 스트림으로 재발행하고 멱등 마커를 먼저 삭제한다', async () => {
    const original = JSON.stringify({ messageId: 'm1', value: 1 })
    const redis = makeRedis([['100-0', ['data', dlqEntry(original)]]])

    const result = await redriveDlq(redis, SOURCE)

    // 멱등 마커 삭제가 재발행보다 먼저 — 같은 키가 dedup-skip되지 않도록
    expect(redis.del).toHaveBeenCalledWith(idemKey(SOURCE, 'm1'))
    expect(redis.xadd).toHaveBeenCalledWith(SOURCE, '*', 'data', original)
    const delOrder = redis.del.mock.invocationCallOrder[0]
    const addOrder = redis.xadd.mock.invocationCallOrder[0]
    expect(delOrder).toBeLessThan(addOrder)
    // 재처리한 엔트리는 DLQ에서 제거(재실행 시 이중 재발행 방지)
    expect(redis.xdel).toHaveBeenCalledWith(DLQ, '100-0')
    expect(result).toEqual({ read: 1, republished: 1, skipped: 0 })
  })

  it('재발행 대상은 봉투의 sourceStream을 따른다(전달 인자와 달라도)', async () => {
    const original = JSON.stringify({ messageId: 'm2', value: 2 })
    const redis = makeRedis([
      ['1-0', ['data', dlqEntry(original, { sourceStream: 'manager:completions:main' })]],
    ])
    await redriveDlq(redis, SOURCE)
    expect(redis.xadd).toHaveBeenCalledWith('manager:completions:main', '*', 'data', original)
    expect(redis.del).toHaveBeenCalledWith(idemKey('manager:completions:main', 'm2'))
  })

  it('reason 필터를 주면 일치하는 엔트리만 재처리한다', async () => {
    const ok = JSON.stringify({ messageId: 'ok', value: 1 })
    const bad = 'not-json'
    const redis = makeRedis([
      ['1-0', ['data', dlqEntry(ok)]],
      ['2-0', ['data', dlqEntry(bad, { reason: 'invalid_schema', attempts: 0 })]],
    ])
    const result = await redriveDlq(redis, SOURCE, { reason: 'handler_failed' })
    expect(redis.xadd).toHaveBeenCalledTimes(1)
    expect(redis.xadd).toHaveBeenCalledWith(SOURCE, '*', 'data', ok)
    // 필터로 걸러진 엔트리는 삭제하지 않는다
    expect(redis.xdel).not.toHaveBeenCalledWith(DLQ, '2-0')
    expect(result.republished).toBe(1)
  })

  it('dedup 키가 없는 원본(envelope·messageId 없음)은 마커 삭제를 건너뛴다', async () => {
    const original = JSON.stringify({ id: 'x', value: 1 }) // messageId/envelope 없음
    const redis = makeRedis([['1-0', ['data', dlqEntry(original)]]])
    await redriveDlq(redis, SOURCE)
    expect(redis.del).not.toHaveBeenCalled()
    expect(redis.xadd).toHaveBeenCalledWith(SOURCE, '*', 'data', original)
  })

  it('파싱 불가 엔트리는 skip하고 DLQ에 보존한다(데이터 보호)', async () => {
    const redis = makeRedis([['1-0', ['data', 'not-an-envelope-json']]])
    const result = await redriveDlq(redis, SOURCE)
    expect(redis.xadd).not.toHaveBeenCalled()
    expect(redis.xdel).not.toHaveBeenCalled()
    expect(result).toEqual({ read: 1, republished: 0, skipped: 1 })
  })

  it('엔트리 하나의 재발행이 실패해도 나머지는 계속 처리한다(드레인 비차단)', async () => {
    const a = JSON.stringify({ messageId: 'a', value: 1 })
    const b = JSON.stringify({ messageId: 'b', value: 2 })
    const redis = makeRedis([
      ['1-0', ['data', dlqEntry(a)]],
      ['2-0', ['data', dlqEntry(b)]],
    ])
    redis.xadd.mockRejectedValueOnce(new Error('redis down'))
    const result = await redriveDlq(redis, SOURCE)
    expect(result).toEqual({ read: 2, republished: 1, skipped: 1 })
    // 두 번째 엔트리는 정상 재발행·삭제
    expect(redis.xadd).toHaveBeenCalledWith(SOURCE, '*', 'data', b)
    expect(redis.xdel).toHaveBeenCalledWith(DLQ, '2-0')
  })

  it('count 옵션을 xrange COUNT로 전달한다(배치 상한)', async () => {
    const redis = makeRedis([])
    await redriveDlq(redis, SOURCE, { count: 25 })
    expect(redis.xrange).toHaveBeenCalledWith(DLQ, '-', '+', 'COUNT', 25)
  })

  it('count 미지정 시 기본 상한으로 xrange한다', async () => {
    const redis = makeRedis([])
    await redriveDlq(redis, SOURCE)
    expect(redis.xrange).toHaveBeenCalledWith(DLQ, '-', '+', 'COUNT', 100)
  })
})

describe('routeToDlq (DLQ 쓰기 단일출처)', () => {
  it('DlqMessage 봉투를 {stream}:dlq로 maxlen 동반 발행한다', async () => {
    const calls: Array<{ stream: string; msg: unknown; opts: unknown }> = []
    const publisher = {
      publish: async (stream: string, msg: unknown, opts?: unknown) => { calls.push({ stream, msg, opts }); return '1-0' },
    }
    await routeToDlq(publisher, 'orchestrator:to-manager:s1', '{"bad":true}', 'invalid_schema', 0)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.stream).toBe('orchestrator:to-manager:s1:dlq')
    expect(calls[0]!.opts).toEqual({ maxlen: DLQ_MAXLEN })
    const m = calls[0]!.msg as Record<string, unknown>
    expect(m).toMatchObject({ original: '{"bad":true}', reason: 'invalid_schema', attempts: 0, sourceStream: 'orchestrator:to-manager:s1' })
    expect(typeof m['failedAt']).toBe('number')
    expect('error' in m).toBe(false)
  })

  it('error 제공 시 메시지 문자열을 포함한다', async () => {
    let captured: Record<string, unknown> = {}
    const publisher = { publish: async (_s: string, msg: unknown) => { captured = msg as Record<string, unknown>; return '1-0' } }
    await routeToDlq(publisher, 'st', 'raw', 'handler_failed', 1, new Error('boom'))
    expect(captured['reason']).toBe('handler_failed')
    expect(captured['attempts']).toBe(1)
    expect(captured['error']).toBe('boom')
  })

  it('publisher.publish가 reject해도 throw하지 않는다(never-throw·삼킴)', async () => {
    const publisher = { publish: async () => { throw new Error('redis down') } }
    await expect(routeToDlq(publisher, 'st', 'raw', 'invalid_schema', 0)).resolves.toBeUndefined()
  })
})
