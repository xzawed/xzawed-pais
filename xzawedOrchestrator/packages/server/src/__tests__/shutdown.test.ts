import { describe, it, expect, vi } from 'vitest'
import { createShutdown, SHUTDOWN_TIMEOUT_MS } from '../shutdown.js'

/**
 * **경계가 있는 종료(bounded shutdown).**
 *
 * 이 서비스에는 종료 핸들러가 아예 없었다 — `index.ts` 전문 13줄에 `process.on` 이
 * 0건이고, 그래서 `onClose` 훅 3개가 한 번도 실행된 적이 없다. 컨테이너는 유예시간을
 * 전부 소진한 뒤 SIGKILL 로 죽었다(실측: `docker stop -t 10` → 11739ms · exit 137.
 * 핸들러만 있는 대조군은 2296ms · exit 0).
 *
 * **그런데 핸들러만 붙이면 오히려 나빠진다.** Fastify 기본 `keepAliveTimeout` 이
 * 72_000ms 라(Node 기본 5_000ms 의 14.4배 — 직접 실측) 인플라이트 요청이 하나라도
 * 있으면 `app.close()` 가 ~71초를 기다린다. 유예 10초를 7배 초과하므로 결말은 여전히
 * SIGKILL 이고, 종료 시간만 0초에서 71초로 늘어난다. 워치독이 이 사양의 핵심이다.
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
      closeServer: vi.fn(async () => { order.push('http-drain') }),
      closeRedis: vi.fn(async () => { order.push('redis-quit') }),
      exit,
      log,
      ...over,
    }),
  }
}

describe('createShutdown — 순서', () => {
  it('HTTP 드레인이 Redis 정리보다 먼저다', async () => {
    // 소비자 루프가 공유 Redis 연결 위에서 BLOCK 읽기를 돈다. 살아 있는 채로 quit 하면
    // 루프가 종료가 아니라 에러 백오프(최대 30s)로 떨어져 이벤트 루프를 붙잡는다.
    const d = deps()
    await d.made()
    expect(d.order).toEqual(['http-drain', 'redis-quit'])
  })

  it('정상 완주하면 exit(0) 이다', async () => {
    const d = deps()
    await d.made()
    expect(d.exit).toHaveBeenCalledWith(0)
  })
})

describe('createShutdown — 재진입 가드', () => {
  it('두 번 불러도 한 번만 실행한다 — SIGTERM 뒤 SIGINT', async () => {
    const closeServer = vi.fn(async () => {})
    const d = deps({ closeServer })
    await Promise.all([d.made(), d.made()])
    expect(closeServer).toHaveBeenCalledTimes(1)
  })
})

describe('createShutdown — 워치독', () => {
  it('예산을 넘기면 exit(1) 로 강제 종료한다', async () => {
    // 이 테스트가 이 슬라이스의 존재 이유다. 워치독이 없으면 인플라이트 요청 1건이
    // 종료를 71초로 늘리고 결말은 SIGKILL 이다.
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
    } finally {
      vi.useRealTimers()
    }
  })

  it('강제 종료된 뒤에는 exit(0) 을 부르지 않는다', async () => {
    // 매달린 단계가 나중에 풀리면 "정상 완주"로 오인하고 0 을 덮어쓸 수 있다.
    // 종료가 깨끗했는지는 종료 코드로 관측 가능해야 한다.
    vi.useFakeTimers()
    try {
      let release: () => void = () => {}
      const hang = new Promise<void>((r) => { release = r })
      const d = deps({ closeServer: () => hang, timeoutMs: 5_000 })
      const running = d.made()
      await vi.advanceTimersByTimeAsync(5_001)
      release()
      await running
      expect(d.exit).toHaveBeenCalledTimes(1)
      expect(d.exit).toHaveBeenCalledWith(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('워치독 타이머는 이벤트 루프를 붙잡지 않는다(unref)', async () => {
    // ref 된 타이머를 남기면 종료가 끝나도 프로세스가 5초 더 산다.
    const d = deps()
    await d.made()
    expect(d.exit).toHaveBeenCalledWith(0)
  })
})

describe('createShutdown — 단계 실패', () => {
  it('한 단계가 던져도 나머지를 계속 정리한다', async () => {
    const order: string[] = []
    const exit = vi.fn()
    const log = vi.fn()
    const made = createShutdown({
      closeServer: async () => { throw new Error('drain boom') },
      closeRedis: async () => { order.push('redis-quit') },
      exit, log,
    })
    await made()
    expect(order).toEqual(['redis-quit'])
    expect(exit).toHaveBeenCalledWith(0)
    expect(log.mock.calls.flat().join(' ')).toContain('http-drain')
  })
})

describe('SHUTDOWN_TIMEOUT_MS', () => {
  it('Docker 기본 유예 10초 안에 든다', () => {
    // compose 에 stop_grace_period 선언이 없어 Docker 기본 10s 가 상한이다(실측 0건).
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThan(10_000)
  })

  it('소비자 블로킹 읽기(BLOCK 2000)를 덮는다', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBeGreaterThanOrEqual(2_000)
  })
})
