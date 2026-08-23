import { describe, it, expect, vi } from 'vitest'
import {
  runProbes, summarize, readinessResult,
  redisPingProbe, loopProbe, pgProbe,
  DEFAULT_PROBE_TIMEOUT_MS,
  type ReadinessProbe,
} from '../health/readiness.js'

/**
 * **실검사 readiness.**
 *
 * 9개 서비스의 `/health` 가 정적 200 이었는데, compose 3벌의 healthcheck 18개와
 * Launcher 의 `running` 판정·설치 마법사 완료 게이트가 전부 그 신호를 쓴다. 즉 Redis 가
 * 죽어 아무 일도 못 하는 서비스가 healthy 로 보고되고 마법사가 완료로 통과시킨다.
 *
 * **그런데 Redis ping 만으로는 그 실패를 못 잡는다.** 기동 시점에 Redis 가 죽어 있으면
 * `SessionDispatcher.start()` 의 `xgroup CREATE` 가 `while` 루프 **밖**에서 throw 해
 * `start()` 가 reject 되고 `.catch(console.error)` 가 로그만 남긴다 — 디스패처는 영구
 * 정지한다. 그동안 ioredis 는 계속 재연결하므로 Redis 가 돌아오면 `ping()` 은 PONG 이다.
 * **살아 있지만 귀머거리**인 상태다. 그래서 루프 가동 여부를 별도 프로브로 노출한다.
 */

const ok = (name: string): ReadinessProbe => ({ name, run: async () => 'ok' })

describe('runProbes — 실패를 삼키지 않는다', () => {
  it('정상 프로브를 ok 로 기록한다', async () => {
    const checks = await runProbes([ok('redis'), ok('loop')])
    expect(checks['redis']?.status).toBe('ok')
    expect(checks['loop']?.status).toBe('ok')
  })

  it('던지는 프로브를 fail 로 환원하고 절대 던지지 않는다', async () => {
    const checks = await runProbes([{ name: 'redis', run: async () => { throw new Error('ECONNREFUSED') } }])
    expect(checks['redis']?.status).toBe('fail')
    expect(checks['redis']?.error).toContain('ECONNREFUSED')
  })

  it('매달리는 프로브를 타임아웃으로 끊는다', async () => {
    // ioredis 는 enableOfflineQueue 기본 true 라 장기 정지 상태에서 ping() 거부가
    // 실측 ~8초 걸린다. prod healthcheck timeout 이 5초라 race 없이는 초과한다.
    const checks = await runProbes([{ name: 'redis', run: () => new Promise<never>(() => {}) }], 30)
    expect(checks['redis']?.status).toBe('fail')
    expect(checks['redis']?.error).toContain('timeout')
  })

  it('에러 메시지를 잘라 응답 폭발을 막는다', async () => {
    const long = 'x'.repeat(500)
    const checks = await runProbes([{ name: 'a', run: async () => { throw new Error(long) } }])
    expect((checks['a']?.error ?? '').length).toBeLessThanOrEqual(120)
  })

  it('프로브를 병렬로 돌린다 — 직렬이면 예산을 곱절로 쓴다', async () => {
    const slow = (name: string): ReadinessProbe => ({
      name, run: async () => { await new Promise((r) => setTimeout(r, 40)); return 'ok' },
    })
    const t0 = Date.now()
    await runProbes([slow('a'), slow('b'), slow('c')])
    expect(Date.now() - t0).toBeLessThan(120)
  })

  it('각 프로브의 소요 시간을 기록한다', async () => {
    const checks = await runProbes([ok('a')])
    expect(typeof checks['a']?.ms).toBe('number')
  })
})

describe('summarize — not_configured 는 실패가 아니다', () => {
  it('전부 ok 면 ready', () => {
    const r = summarize('svc', { redis: { status: 'ok', ms: 1 } })
    expect(r.status).toBe('ready')
    expect(r.service).toBe('svc')
  })

  it('fail 이 하나라도 있으면 not_ready', () => {
    const r = summarize('svc', { redis: { status: 'ok', ms: 1 }, loop: { status: 'fail', ms: 0 } })
    expect(r.status).toBe('not_ready')
  })

  it('not_configured 만 있으면 ready — 미구성은 장애가 아니다', () => {
    // prod compose 는 Manager 에 DATABASE_URL 을 주지 않는다. 미구성을 실패로 세면
    // Launcher 가 실제로 배포하는 구성에서 Manager 가 **영구 unhealthy** 가 된다.
    const r = summarize('svc', { redis: { status: 'ok', ms: 1 }, db: { status: 'not_configured', ms: 0 } })
    expect(r.status).toBe('ready')
  })
})

describe('readinessResult — 상태 코드', () => {
  it('ready 는 200', async () => {
    const res = await readinessResult('svc', [ok('a')])
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('ready')
  })

  it('not_ready 는 503', async () => {
    const res = await readinessResult('svc', [{ name: 'a', run: async () => 'fail' }])
    expect(res.statusCode).toBe(503)
    expect(res.body.status).toBe('not_ready')
  })

  it('프로브가 없으면 ready — 의존이 없는 서비스도 표현 가능해야 한다', async () => {
    const res = await readinessResult('svc', [])
    expect(res.statusCode).toBe(200)
  })
})

describe('redisPingProbe', () => {
  it('PONG 이면 ok', async () => {
    const checks = await runProbes([redisPingProbe({ ping: async () => 'PONG' })])
    expect(checks['redis']?.status).toBe('ok')
  })

  it('거부하면 fail', async () => {
    const checks = await runProbes([redisPingProbe({ ping: async () => { throw new Error('down') } })])
    expect(checks['redis']?.status).toBe('fail')
  })
})

describe('loopProbe — 이 슬라이스의 핵심', () => {
  it('루프가 돌고 있으면 ok', async () => {
    const checks = await runProbes([loopProbe('dispatcher', () => true)])
    expect(checks['dispatcher']?.status).toBe('ok')
  })

  it('루프가 멈춰 있으면 fail — Redis ping 은 이때도 PONG 이다', async () => {
    // 이 한 줄이 "살아 있지만 귀머거리"를 잡는 유일한 신호다.
    const checks = await runProbes([
      redisPingProbe({ ping: async () => 'PONG' }),
      loopProbe('dispatcher', () => false),
    ])
    expect(checks['redis']?.status).toBe('ok')
    expect(checks['dispatcher']?.status).toBe('fail')
    expect(summarize('svc', checks).status).toBe('not_ready')
  })

  it('루프가 아예 배선되지 않았으면 not_configured', async () => {
    // Orchestrator 의 projectGateway 는 dbPool 이 없으면 생성조차 되지 않는다.
    const checks = await runProbes([loopProbe('gateway', () => undefined)])
    expect(checks['gateway']?.status).toBe('not_configured')
  })
})

describe('pgProbe — 3상태', () => {
  it('풀이 없으면 not_configured', async () => {
    const checks = await runProbes([pgProbe(() => null)])
    expect(checks['db']?.status).toBe('not_configured')
  })

  it('질의가 성공하면 ok', async () => {
    const checks = await runProbes([pgProbe(() => ({ query: async () => ({ rows: [] }) }))])
    expect(checks['db']?.status).toBe('ok')
  })

  it('종료된 풀은 fail — code 가 없는 평범한 Error 다', async () => {
    const ended = { query: async () => { throw new Error('Cannot use a pool after calling end on the pool') } }
    const checks = await runProbes([pgProbe(() => ended)])
    expect(checks['db']?.status).toBe('fail')
    expect(checks['db']?.error).toContain('after calling end')
  })

  it('풀이 포화되면 타임아웃으로 끊는다 — 무한 대기하지 않는다', async () => {
    // connectionTimeoutMillis 가 없어 pg-pool 이 타임아웃 없는 큐에 넣는다(실측 6029ms).
    // 예산이 없으면 "바쁘다"가 "죽었다"로 오보된다 — 그래도 끊는 쪽이 맞다.
    const saturated = { query: () => new Promise<never>(() => {}) }
    const checks = await runProbes([pgProbe(() => saturated)], 30)
    expect(checks['db']?.status).toBe('fail')
    expect(checks['db']?.error).toContain('timeout')
  })
})

describe('DEFAULT_PROBE_TIMEOUT_MS', () => {
  it('prod healthcheck timeout(5s) 안에 든다', () => {
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBeLessThan(5_000)
  })
})

describe('타이머 위생', () => {
  it('타임아웃 타이머를 정리한다 — 프로세스를 붙잡지 않는다', async () => {
    // 프로토타입이 `unref()` 를 넣었다가 매달린 프로브 구간에서
    // "Detected unsettled top-level await" + exit 13 으로 죽었다.
    // 정답은 unref 가 아니라 finally 의 clearTimeout 이다.
    const spy = vi.spyOn(global, 'clearTimeout')
    await runProbes([ok('a')])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

