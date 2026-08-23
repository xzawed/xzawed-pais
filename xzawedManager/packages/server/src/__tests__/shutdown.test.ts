import { describe, it, expect, vi } from 'vitest'
import { createShutdown, SHUTDOWN_TIMEOUT_MS } from '../shutdown.js'

/**
 * **종료 순서 역전(D6)의 교정.**
 *
 * 이전 판은 `closeAll()` → `app.close()` → `closeRedisClients()` 순이었고,
 * `closeAll` 의 마지막 두 줄이 `registry.closeAll()` 과 `closePool()` 이었다.
 * 즉 **DB 풀을 닫은 뒤에 HTTP 를 드레인**했다. 그 창에서 진행 중이던 요청은 이미
 * `end()` 된 pg 풀을 만나 `Cannot use a pool after calling end on the pool` 로 죽는다.
 * 창의 길이는 "잠깐"이 아니라 종료 시점 최장 in-flight 쿼리 시간 전체다 —
 * `pg-pool.end()` 는 체크아웃된 클라이언트가 전부 반납될 때까지 resolve 하지 않는다.
 *
 * 이 서비스의 `onClose` 훅은 **0개**라, 드레인이 뒤로 밀려서 훅을 잃는 문제가 아니다.
 * 잃는 것은 인플라이트 HTTP 요청 그 자체다.
 */

function deps(over: Partial<Parameters<typeof createShutdown>[0]> = {}) {
  const order: string[] = []
  const exit = vi.fn()
  const log = vi.fn()
  return {
    order,
    exit,
    log,
    made: createShutdown({
      stopIntake: vi.fn(() => { order.push('stop-intake') }),
      closeServer: vi.fn(async () => { order.push('http-drain') }),
      closeResources: vi.fn(async () => { order.push('close-resources') }),
      closeRedis: vi.fn(async () => { order.push('redis-quit') }),
      exit,
      log,
      ...over,
    }),
  }
}

describe('createShutdown — 순서 (D6 교정)', () => {
  it('인테이크 차단 → HTTP 드레인 → 자원 해제 → Redis 순이다', async () => {
    const d = deps()
    await d.made()
    expect(d.order).toEqual(['stop-intake', 'http-drain', 'close-resources', 'redis-quit'])
  })

  it('HTTP 드레인이 자원 해제(registry·DB 풀)보다 **먼저**다', async () => {
    // 이 한 줄이 D6 교정 그 자체다. 반대면 인플라이트 요청이 닫힌 풀을 만난다.
    const d = deps()
    await d.made()
    expect(d.order.indexOf('http-drain')).toBeLessThan(d.order.indexOf('close-resources'))
  })

  it('인테이크 차단이 드레인보다 먼저다 — 드레인 시간이 곧 새 작업 유입 창이다', async () => {
    const d = deps()
    await d.made()
    expect(d.order.indexOf('stop-intake')).toBeLessThan(d.order.indexOf('http-drain'))
  })

  it('Redis 정리가 마지막이다 — 소비자 루프가 그 연결 위에서 블로킹 읽기를 한다', async () => {
    const d = deps()
    await d.made()
    expect(d.order[d.order.length - 1]).toBe('redis-quit')
  })
})

describe('createShutdown — 재진입 가드', () => {
  it('두 번 불러도 한 번만 실행한다', async () => {
    const stopIntake = vi.fn()
    const d = deps({ stopIntake })
    await Promise.all([d.made(), d.made()])
    expect(stopIntake).toHaveBeenCalledTimes(1)
  })
})

describe('createShutdown — 워치독', () => {
  it('예산을 넘기면 exit(1) 로 강제 종료한다', async () => {
    vi.useFakeTimers()
    try {
      let release: () => void = () => {}
      const hang = new Promise<void>((r) => { release = r })
      const d = deps({ closeServer: () => hang, timeoutMs: 5_000 })
      const running = d.made()
      await vi.advanceTimersByTimeAsync(5_001)
      expect(d.exit).toHaveBeenCalledWith(1)
      release()
      await running
      expect(d.exit).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createShutdown — 단계 실패', () => {
  it('드레인이 던져도 자원 해제와 Redis 정리를 계속한다', async () => {
    const order: string[] = []
    const exit = vi.fn()
    const log = vi.fn()
    const made = createShutdown({
      stopIntake: () => { order.push('stop-intake') },
      closeServer: async () => { throw new Error('drain boom') },
      closeResources: async () => { order.push('close-resources') },
      closeRedis: async () => { order.push('redis-quit') },
      exit, log,
    })
    await made()
    expect(order).toEqual(['stop-intake', 'close-resources', 'redis-quit'])
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('동기 인테이크 차단이 던져도 나머지를 계속한다', async () => {
    const order: string[] = []
    const exit = vi.fn()
    const made = createShutdown({
      stopIntake: () => { throw new Error('intake boom') },
      closeServer: async () => { order.push('http-drain') },
      closeResources: async () => { order.push('close-resources') },
      closeRedis: async () => { order.push('redis-quit') },
      exit, log: vi.fn(),
    })
    await made()
    expect(order).toEqual(['http-drain', 'close-resources', 'redis-quit'])
  })
})

describe('SHUTDOWN_TIMEOUT_MS', () => {
  it('Docker 기본 유예 10초 안에 들고 소비자 BLOCK 2000 을 덮는다', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThan(10_000)
    expect(SHUTDOWN_TIMEOUT_MS).toBeGreaterThanOrEqual(2_000)
  })
})
