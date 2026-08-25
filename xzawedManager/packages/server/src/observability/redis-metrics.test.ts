import { describe, it, expect, vi } from 'vitest'
import {
  collectDlqMetrics, collectPelMetrics, SCAN_KEY_LIMIT, SCAN_ROUNDTRIP_LIMIT, TOP_N, type MetricsRedis,
} from './redis-metrics.js'

/**
 * **DLQ·PEL 은 고정 키 목록으로 잴 수 없다**(S3.3 / 수용 기준 L2-8).
 *
 * 스트림이 per-session·per-workflow 라 DLQ 키 `{stream}:dlq` 도 같이 늘어난다. 알려진 키 하나만
 * 재면 나머지가 쌓여 있어도 **0 을 보고**한다 — 관측에서 최악인 초록 거짓말이다.
 * 그래서 키스페이스를 실제로 훑고, **잘라내면 그 사실까지 지표로 낸다.**
 */

/** SCAN 을 커서로 나눠 돌려주는 목 — 실 Redis 처럼 여러 번에 걸쳐 준다. */
function fakeRedis(opts: {
  streams?: string[]
  lens?: Record<string, number>
  groups?: Record<string, unknown>
  pageSize?: number
  xinfoThrowsFor?: string[]
}): MetricsRedis & { scanCalls: number } {
  const all = opts.streams ?? []
  const page = opts.pageSize ?? 1000
  const state = { scanCalls: 0 }
  return {
    get scanCalls() { return state.scanCalls },
    scan: vi.fn(async (cursor: number | string, _m: 'MATCH', pattern: string) => {
      state.scanCalls += 1
      // 목에서도 MATCH 를 흉내 낸다 — `*:dlq` 와 `*` 를 구분해야 두 수집기가 갈린다.
      const matched = pattern === '*' ? all : all.filter((k) => k.endsWith(':dlq'))
      const start = Number(cursor)
      const slice = matched.slice(start, start + page)
      const next = start + page >= matched.length ? '0' : String(start + page)
      return [next, slice] as [string, string[]]
    }) as never,
    xlen: vi.fn(async (k: string) => opts.lens?.[k] ?? 0),
    xinfo: vi.fn(async (_sub: 'GROUPS', k: string) => {
      if (opts.xinfoThrowsFor?.includes(k)) throw new Error('NOGROUP/삭제됨')
      return opts.groups?.[k] ?? []
    }) as never,
  }
}

/** `XINFO GROUPS` 실제 응답 모양(평면 배열의 배열). */
const group = (name: string, pending: number) => ['name', name, 'consumers', 1, 'pending', pending]

describe('collectDlqMetrics — 여러 세션의 DLQ 를 전부 센다', () => {
  it('per-session DLQ 를 합산하고 스트림 수를 보고한다', async () => {
    const r = fakeRedis({
      streams: ['manager:to-designer:s1:dlq', 'manager:to-planner:s2:dlq', 'manager:decomposition:main:dlq'],
      lens: { 'manager:to-designer:s1:dlq': 3, 'manager:to-planner:s2:dlq': 2, 'manager:decomposition:main:dlq': 1 },
    })
    const m = await collectDlqMetrics(r)
    expect(m.streams).toBe(3)
    expect(m.total).toBe(6)
    expect(m.truncated).toBe(false)
  })

  /** 하나만 재던 시절의 실패를 고정한다 — 한 스트림만 보면 6 이 아니라 3 이다. */
  it('한 스트림만 세면 나오는 값과 다르다(초록 거짓말 방지)', async () => {
    const r = fakeRedis({
      streams: ['a:dlq', 'b:dlq'],
      lens: { 'a:dlq': 0, 'b:dlq': 7 },
    })
    const m = await collectDlqMetrics(r)
    expect(m.total, '첫 스트림만 셌다면 0 이 나온다').toBe(7)
  })

  /** 깊이 0 도 스트림 수에는 센다 — "격리됐다 redrive 됨"과 "애초에 없음"은 다른 상태다. */
  it('깊이 0 인 DLQ 도 스트림 수에 포함한다', async () => {
    const r = fakeRedis({ streams: ['a:dlq'], lens: { 'a:dlq': 0 } })
    const m = await collectDlqMetrics(r)
    expect(m.streams).toBe(1)
    expect(m.total).toBe(0)
  })

  it('상위 N 은 깊이 내림차순이다', async () => {
    const streams = Array.from({ length: TOP_N + 5 }, (_, i) => `s${i}:dlq`)
    const lens = Object.fromEntries(streams.map((s, i) => [s, i]))
    const m = await collectDlqMetrics(fakeRedis({ streams, lens }))
    expect(m.top).toHaveLength(TOP_N)
    expect(m.top[0]!.depth).toBeGreaterThan(m.top[1]!.depth)
  })

  /** 커서를 끝까지 돌지 않으면 합계가 조용히 작아진다. */
  it('SCAN 커서를 끝까지 따라간다(여러 페이지)', async () => {
    const streams = Array.from({ length: 250 }, (_, i) => `s${i}:dlq`)
    const lens = Object.fromEntries(streams.map((s) => [s, 1]))
    const m = await collectDlqMetrics(fakeRedis({ streams, lens, pageSize: 100 }))
    expect(m.streams).toBe(250)
    expect(m.total).toBe(250)
  })

  it('상한을 넘으면 잘라내고 그 사실을 알린다(합계는 하한)', async () => {
    const streams = Array.from({ length: SCAN_KEY_LIMIT + 50 }, (_, i) => `s${i}:dlq`)
    const lens = Object.fromEntries(streams.map((s) => [s, 1]))
    const m = await collectDlqMetrics(fakeRedis({ streams, lens, pageSize: 500 }))
    expect(m.truncated).toBe(true)
    expect(m.streams).toBe(SCAN_KEY_LIMIT)
    expect(m.total).toBeLessThan(streams.length)
  })
})

describe('collectPelMetrics — 그룹별 PEL 깊이', () => {
  it('XINFO GROUPS 를 파싱해 합산한다', async () => {
    const r = fakeRedis({
      streams: ['manager:decomposition:main', 'manager:completions:main'],
      groups: {
        'manager:decomposition:main': [group('manager-taskgraph-consumers', 2)],
        'manager:completions:main': [group('manager-completion-consumers', 5)],
      },
    })
    const m = await collectPelMetrics(r)
    expect(m.groups).toBe(2)
    expect(m.total).toBe(7)
  })

  /** DLQ 에는 소비자 그룹이 없고, 있어도 그 PEL 은 격리 메시지가 아니라 redrive 도구 상태다. */
  it('DLQ 스트림은 제외한다', async () => {
    const r = fakeRedis({
      streams: ['s:dlq', 'live'],
      groups: { 's:dlq': [group('g', 99)], live: [group('g', 1)] },
    })
    const m = await collectPelMetrics(r)
    expect(m.total).toBe(1)
    expect(m.top.every((t) => !t.stream.endsWith(':dlq'))).toBe(true)
  })

  /** 수집 도중 사라진 스트림 하나 때문에 전체 지표를 잃으면 안 된다. */
  it('XINFO 가 throw 하는 스트림은 건너뛰고 나머지를 센다', async () => {
    const r = fakeRedis({
      streams: ['gone', 'live'],
      groups: { live: [group('g', 4)] },
      xinfoThrowsFor: ['gone'],
    })
    const m = await collectPelMetrics(r)
    expect(m.total).toBe(4)
    expect(m.groups).toBe(1)
  })

  it('그룹이 없는 스트림은 0 건으로 다룬다', async () => {
    const m = await collectPelMetrics(fakeRedis({ streams: ['live'], groups: { live: [] } }))
    expect(m.groups).toBe(0)
    expect(m.total).toBe(0)
  })

  /**
   * 응답 모양이 예상과 다르면 숫자를 지어내지 않는다 — 다만 **조용히 버리지도 않는다.**
   * 그러면 "PEL 0" 과 "PEL 을 못 읽었다"가 같은 출력이 된다.
   */
  it('깨진 XINFO 응답은 추정하지 않고 실패로 센다', async () => {
    const r = fakeRedis({ streams: ['live'], groups: { live: ['not-an-array', ['name']] } })
    const m = await collectPelMetrics(r)
    expect(m.groups).toBe(0)
    expect(m.total).toBe(0)
    expect(m.errors, '조용히 0 을 보고하면 못 읽은 것과 구분되지 않는다').toBe(2)
    expect(m.truncated).toBe(true)
  })

  /** RESP3 로 바뀌면 맵이 온다 — 그때 "그룹 0개"라고 말하면 그것이 초록 거짓말이다. */
  it('배열이 아닌 XINFO 응답(RESP3 맵 모양)은 0 이 아니라 실패로 낸다', async () => {
    const r = fakeRedis({ streams: ['live'], groups: { live: { name: 'g', pending: 9 } } })
    const m = await collectPelMetrics(r)
    expect(m.groups).toBe(0)
    expect(m.errors).toBe(1)
    expect(m.truncated).toBe(true)
  })

  it('문자열로 온 pending 도 숫자로 센다', async () => {
    const r = fakeRedis({ streams: ['live'], groups: { live: [['name', 'g', 'pending', '3']] } })
    expect((await collectPelMetrics(r)).total).toBe(3)
  })
})

/**
 * **왕복 상한**(Grok 반증이 지적한 자리).
 *
 * `TYPE stream` 필터는 서버측이지만 커서는 **키스페이스 전체**를 걷는다 — 스트림이 몇 개뿐이어도
 * `idem:*` 마커가 수백만이면 한 번의 스크레이프가 전부를 순회한다. `/metrics` 는 주기적으로
 * 긁히므로 그 비용이 상시 부하가 된다.
 */
describe('SCAN 왕복 상한 — 큰 키스페이스를 상시 순회하지 않는다', () => {
  /** 스트림은 거의 없는데 커서가 끝나지 않는 Redis(비스트림 키가 대부분인 상황). */
  function neverEndingScan(hits: string[]) {
    let calls = 0
    return {
      get calls() { return calls },
      scan: vi.fn(async () => {
        calls += 1
        // 매 왕복 빈 배치 — 실제로는 비스트림 키만 훑고 지나가는 구간이다.
        return [String(calls), calls === 1 ? hits : []] as [string, string[]]
      }) as never,
      xlen: vi.fn(async () => 1),
      xinfo: vi.fn(async () => []) as never,
    }
  }

  it('상한에서 멈추고 truncated 로 알린다', async () => {
    const r = neverEndingScan(['a:dlq'])
    const m = await collectDlqMetrics(r)
    expect(m.truncated, '끝나지 않는 커서를 계속 따라가고 있다').toBe(true)
    expect(r.calls).toBe(SCAN_ROUNDTRIP_LIMIT)
  })

  it('상한에 걸려도 그때까지 본 것은 보고한다(전부 버리지 않는다)', async () => {
    const m = await collectDlqMetrics(neverEndingScan(['a:dlq', 'b:dlq']))
    expect(m.streams).toBe(2)
    expect(m.total).toBe(2)
  })

  /** 정상 키스페이스(커서가 곧 0)는 상한에 걸리지 않아야 한다 — 과잉 차단이면 항상 하한이 된다. */
  it('커서가 정상 종료하면 truncated 가 아니다', async () => {
    const r = fakeRedis({ streams: ['a:dlq', 'b:dlq'], lens: { 'a:dlq': 1, 'b:dlq': 2 } })
    const m = await collectDlqMetrics(r)
    expect(m.truncated).toBe(false)
    expect(m.total).toBe(3)
  })

  /**
   * **경계 과잉 절단**(Grok 반증). 정확히 상한만큼 있고 스캔이 끝났으면 그건 완전한 값이다 —
   * 여기서 `truncated` 를 세우면 맞는 숫자를 하한이라고 말하는 반대 방향 거짓말이 된다.
   */
  it('정확히 상한이고 커서가 끝났으면 truncated 가 아니다', async () => {
    const streams = Array.from({ length: SCAN_KEY_LIMIT }, (_, i) => `s${i}:dlq`)
    const lens = Object.fromEntries(streams.map((s) => [s, 1]))
    const m = await collectDlqMetrics(fakeRedis({ streams, lens, pageSize: 500 }))
    expect(m.streams).toBe(SCAN_KEY_LIMIT)
    expect(m.total, '전량을 셌다').toBe(SCAN_KEY_LIMIT)
    expect(m.truncated, '실제로 자른 게 없는데 하한이라고 말한다').toBe(false)
  })

  /** 한 개라도 넘치면 그건 진짜 절단이다. */
  it('상한을 1개 넘기면 잘라내고 truncated 다', async () => {
    const streams = Array.from({ length: SCAN_KEY_LIMIT + 1 }, (_, i) => `s${i}:dlq`)
    const lens = Object.fromEntries(streams.map((s) => [s, 1]))
    const m = await collectDlqMetrics(fakeRedis({ streams, lens, pageSize: SCAN_KEY_LIMIT + 1 }))
    expect(m.streams).toBe(SCAN_KEY_LIMIT)
    expect(m.truncated).toBe(true)
  })
})

/**
 * **부분 실패를 완전한 척하지 않는다**(Grok 반증 2건).
 *
 * 1. SCAN 은 같은 키를 여러 번 줄 수 있다 — 중복을 세면 합계가 부풀고, 그때 `truncated` 는
 *    여전히 거짓이라 "정확한 값"으로 읽힌다.
 * 2. 개별 키의 `XLEN`·`XINFO` 실패가 위로 새어 나가면 라우트가 통째로 잡아 `pais_redis_up 0`
 *    을 낸다 — Redis 는 멀쩡한데 "못 읽었다"는 거짓이다. 건너뛰되 하한으로 표시한다.
 */
describe('부분 실패 정직성', () => {
  /** 리해싱 중 커서 되감기 재현 — 같은 키를 두 배치에 걸쳐 준다. */
  function duplicatingScan(keys: string[]) {
    let calls = 0
    return {
      scan: vi.fn(async () => {
        calls += 1
        return [calls >= 2 ? '0' : '1', keys] as [string, string[]]
      }) as never,
      xlen: vi.fn(async () => 7),
      xinfo: vi.fn(async () => [group('g', 5)]) as never,
    }
  }

  it('SCAN 중복 키를 두 번 세지 않는다(DLQ)', async () => {
    const m = await collectDlqMetrics(duplicatingScan(['a:dlq']))
    expect(m.streams, '중복을 그대로 push 하면 2 가 된다').toBe(1)
    expect(m.total, '중복 계수면 14 로 부푼다').toBe(7)
    expect(m.truncated).toBe(false)
  })

  it('SCAN 중복 키를 두 번 세지 않는다(PEL)', async () => {
    const m = await collectPelMetrics(duplicatingScan(['live']))
    expect(m.groups).toBe(1)
    expect(m.total).toBe(5)
  })

  it('XLEN 이 throw 하는 스트림은 건너뛰고 나머지를 센다', async () => {
    const r = fakeRedis({ streams: ['bad:dlq', 'good:dlq'], lens: { 'good:dlq': 9 } })
    r.xlen = vi.fn(async (k: string) => {
      if (k === 'bad:dlq') throw new Error('WRONGTYPE')
      return 9
    })
    const m = await collectDlqMetrics(r)
    expect(m.total, '한 키 실패가 전체를 날리면 여기 도달조차 못 한다').toBe(9)
    expect(m.streams).toBe(1)
  })

  it('스트림별 실패는 errors 로 세고 합계를 하한으로 표시한다(DLQ)', async () => {
    const r = fakeRedis({ streams: ['bad:dlq', 'good:dlq'], lens: { 'good:dlq': 9 } })
    r.xlen = vi.fn(async (k: string) => {
      if (k === 'bad:dlq') throw new Error('WRONGTYPE')
      return 9
    })
    const m = await collectDlqMetrics(r)
    expect(m.errors).toBe(1)
    expect(m.truncated, '일부를 못 봤는데 완전한 값인 척하면 안 된다').toBe(true)
  })

  it('스트림별 실패는 errors 로 세고 합계를 하한으로 표시한다(PEL)', async () => {
    const m = await collectPelMetrics(fakeRedis({
      streams: ['gone', 'live'], groups: { live: [group('g', 4)] }, xinfoThrowsFor: ['gone'],
    }))
    expect(m.errors).toBe(1)
    expect(m.truncated).toBe(true)
    expect(m.total).toBe(4)
  })

  it('실패가 없으면 errors 0 이고 truncated 도 거짓이다(과잉 하한 금지)', async () => {
    const m = await collectDlqMetrics(fakeRedis({ streams: ['a:dlq'], lens: { 'a:dlq': 2 } }))
    expect(m.errors).toBe(0)
    expect(m.truncated).toBe(false)
  })
})
