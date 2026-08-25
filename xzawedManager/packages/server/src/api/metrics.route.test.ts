import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { metricsRoute } from './metrics.route.js'
import type { MetricsRedis } from '../observability/redis-metrics.js'

/**
 * `GET /metrics`(S3.3 / 수용 기준 L2-8).
 *
 * **`/metrics` 는 헬스체크가 아니다.** Redis 가 없거나 수집이 실패해도 200 을 준다 — 여기서
 * 500 을 내면 스크레이퍼가 지표를 통째로 잃고, 정작 "Redis 가 죽었다"는 사실도 못 본다.
 * 그 사실은 `pais_redis_up 0` 으로 **지표 자체가** 말한다(readiness 는 `/health/ready` 몫).
 */

const group = (name: string, pending: number) => ['name', name, 'pending', pending]

function stubRedis(over: Partial<MetricsRedis> = {}): MetricsRedis {
  return {
    scan: vi.fn(async () => ['0', []] as [string, string[]]) as never,
    xlen: vi.fn(async () => 0),
    xinfo: vi.fn(async () => []) as never,
    ...over,
  }
}

async function get(deps: Parameters<typeof metricsRoute>[1]) {
  const app = Fastify()
  await app.register(metricsRoute, deps)
  const res = await app.inject({ method: 'GET', url: '/metrics' })
  await app.close()
  return res
}

describe('GET /metrics', () => {
  it('Prometheus 텍스트 형식으로 응답한다', async () => {
    const res = await get({ redis: () => stubRedis() })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toContain('# TYPE pais_dlq_messages_total gauge')
  })

  it('DLQ·PEL 합계와 절단 플래그를 노출한다', async () => {
    // DLQ 수집은 `*:dlq` 로, PEL 수집은 `*` 로 훑는다 — 목도 그 구분을 따라야 두 값이 갈린다.
    const redis = stubRedis({
      scan: vi.fn(async (_c, _m, pattern: string) =>
        ['0', pattern === '*' ? ['live', 'a:dlq'] : ['a:dlq']] as [string, string[]]) as never,
      xlen: vi.fn(async () => 4),
      xinfo: vi.fn(async (_s: 'GROUPS', k: string) => (k === 'live' ? [group('g1', 6)] : [])) as never,
    })
    const res = await get({ redis: () => redis })
    expect(res.body).toContain('pais_dlq_messages_total 4')
    expect(res.body).toContain('pais_pending_messages_total 6')
    expect(res.body).toContain('pais_dlq_scan_truncated 0')
    expect(res.body).toContain('pais_redis_up 1')
  })

  /** 미구성과 장애를 지표로 구분할 수 있어야 운영자가 원인을 안다. */
  it('Redis 미구성이면 200 + pais_redis_up 0', async () => {
    const res = await get({ redis: () => null })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('pais_redis_up 0')
  })

  it('접근자 자체가 없어도 200 이다', async () => {
    const res = await get({})
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('pais_redis_up 0')
  })

  /** 수집 실패를 500 으로 바꾸면 스크레이퍼가 지표를 통째로 잃는다. */
  it('수집이 throw 해도 500 이 아니라 pais_redis_up 0 이다', async () => {
    const redis = stubRedis({ scan: vi.fn(async () => { throw new Error('redis down') }) as never })
    const res = await get({ redis: () => redis })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('pais_redis_up 0')
  })

  /**
   * **못 읽은 것을 0 으로 내보내지 않는다.** 그건 "DLQ 가 비었다"는 진짜 거짓이고, 쌓이는 중에
   * Redis 가 끊기면 경보가 조용히 해제된다. 계열이 없어지는 쪽은 규칙에서 `or pais_redis_up == 0`
   * 으로 다룰 문제다 — 숫자를 지어내서 풀 문제가 아니다. 이 결정을 테스트로 못 박는다.
   */
  it('수집 실패 시 DLQ·PEL 계열을 0 으로 채우지 않는다(없어진다)', async () => {
    const redis = stubRedis({ scan: vi.fn(async () => { throw new Error('redis down') }) as never })
    const res = await get({ redis: () => redis })
    expect(res.body).not.toContain('pais_dlq_messages_total')
    expect(res.body).not.toContain('pais_pending_messages_total')
  })

  /** 세션 id 가 라벨로 나가므로 이스케이프가 깨지면 노출 형식 자체가 망가진다. */
  it('라벨 값의 따옴표·역슬래시를 이스케이프한다', async () => {
    const nasty = 'manager:to-x:a"b\\c:dlq'
    const redis = stubRedis({
      scan: vi.fn(async (_c, _m, pattern: string) => ['0', pattern === '*' ? [] : [nasty]]) as never,
      xlen: vi.fn(async () => 1),
    })
    const res = await get({ redis: () => redis })
    expect(res.body).toContain('stream="manager:to-x:a\\"b\\\\c:dlq"')
  })

  it('본문은 개행으로 끝난다(exposition 형식)', async () => {
    const res = await get({ redis: () => stubRedis() })
    expect(res.body.endsWith('\n')).toBe(true)
  })
})

/** 부분 실패는 지표로 드러난다 — 조용히 작아진 합계가 정확한 값인 척하면 안 된다. */
describe('GET /metrics — 부분 실패 노출', () => {
  it('스트림별 실패를 errors 게이지와 truncated 로 낸다', async () => {
    const redis = stubRedis({
      scan: vi.fn(async (_c, _m, pattern: string) =>
        ['0', pattern === '*' ? ['live'] : ['bad:dlq']] as [string, string[]]) as never,
      xlen: vi.fn(async () => { throw new Error('WRONGTYPE') }),
      xinfo: vi.fn(async () => { throw new Error('gone') }) as never,
    })
    const res = await get({ redis: () => redis })
    expect(res.statusCode).toBe(200)
    // 핵심: Redis 를 읽었으므로 up 은 1 이다 — 한 키 실패로 0 을 내면 그것이 거짓이다.
    expect(res.body).toContain('pais_redis_up 1')
    expect(res.body).toContain('pais_dlq_stream_errors 1')
    expect(res.body).toContain('pais_dlq_scan_truncated 1')
    expect(res.body).toContain('pais_pel_stream_errors 1')
    expect(res.body).toContain('pais_pel_scan_truncated 1')
  })

  it('정상 수집이면 errors 는 0 이다', async () => {
    const res = await get({ redis: () => stubRedis() })
    expect(res.body).toContain('pais_dlq_stream_errors 0')
    expect(res.body).toContain('pais_pel_stream_errors 0')
  })
})
