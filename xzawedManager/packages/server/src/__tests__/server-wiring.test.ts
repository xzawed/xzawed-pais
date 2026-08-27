import { describe, test, expect, afterEach } from 'vitest'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'

/**
 * **`buildServer` 는 테스트에서 부를 수 있다.** 이 파일이 그 증거다.
 *
 * 오래 반대로 적혀 있었다 — `server.ts` JSDoc 도 `xzawedManager/CLAUDE.md` 도 "DB·Redis·Anthropic
 * 배선을 통째로 끌고 와 테스트가 부르지 못한다"고 했고, 그 믿음 때문에 배선 판정이 아무도 보지
 * 않는 자리에서 자랐다(실측 라인 1/236 · 분기 0/396). 실제로는 셋 다 지연 연결이라 부를 수 있다.
 *
 * - `DATABASE_URL` 미설정이면 pg 경로를 통째로 건너뛴다(`pool === undefined` 분기).
 * - Redis 클라이언트는 `lazyConnect` 이고 `VITEST=true` 에서 `retryStrategy: () => null` 이라
 *   죽은 포트를 줘도 무한 재연결로 이벤트 루프를 잡지 않는다. 소비자 `.start()` 는 fire-and-forget
 *   이고 실패는 로그로만 남는다.
 * - `new Anthropic(...)` 은 생성자에서 네트워크를 치지 않는다.
 *
 * **무엇을 단언하나.** 라우트 트리다 — "플래그를 켰더니 무언가 배선됐는가"를 경고 문구가 아니라
 * **실제 등록 결과**로 본다. 경고는 `startup-warnings.ts` 가 순수 함수로 따로 고정한다.
 *
 * pool 이 필요한 분기(결정 라우트·Supervisor 등)는 여기서 못 덮는다 — 그것은 `DATABASE_URL` 이
 * 있는 통합 테스트의 몫이다. 여기서 덮는 것은 **DB 없이도 성립하는 배선 결정**이다.
 */
const DEAD_REDIS = 'redis://127.0.0.1:1'
const PROBE_KEY = 'sk-ant-test-not-a-real-key-0000000000'
const SERVICE_SECRET = 'test-service-secret-0123456789-abcd'

const TOUCHED = [
  'ANTHROPIC_API_KEY', 'REDIS_URL', 'DATABASE_URL', 'PORT', 'MODE',
  'SERVICE_JWT_SECRET', 'TASK_MANAGER_ENABLED', 'MANAGER_DECISION_ROUTING',
] as const
const saved = new Map<string, string | undefined>()

async function withServer<T>(env: Record<string, string>, fn: (routes: string) => T): Promise<T> {
  for (const k of TOUCHED) { if (!saved.has(k)) saved.set(k, process.env[k]); delete process.env[k] }
  process.env['ANTHROPIC_API_KEY'] = PROBE_KEY
  process.env['REDIS_URL'] = DEAD_REDIS
  process.env['PORT'] = '3999'
  process.env['MODE'] = 'local'
  for (const [k, v] of Object.entries(env)) process.env[k] = v

  const built = await buildServer(loadConfig())
  try {
    return fn(built.app.printRoutes())
  } finally {
    built.stopIntake()
    await built.closeResources()
    await built.app.close()
  }
}

afterEach(() => {
  for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  saved.clear()
})

describe('buildServer — 부를 수 있다', () => {
  test('pg 없이·죽은 Redis 로도 기동하고 /health 가 200 이다', async () => {
    for (const k of TOUCHED) { if (!saved.has(k)) saved.set(k, process.env[k]); delete process.env[k] }
    process.env['ANTHROPIC_API_KEY'] = PROBE_KEY
    process.env['REDIS_URL'] = DEAD_REDIS
    process.env['PORT'] = '3999'
    process.env['MODE'] = 'local'
    const built = await buildServer(loadConfig())
    try {
      const res = await built.app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
    } finally {
      built.stopIntake()
      await built.closeResources()
      await built.app.close()
    }
  })

  test('종료 계약 셋을 모두 돌려준다(stopIntake·closeResources·closeAll)', async () => {
    for (const k of TOUCHED) { if (!saved.has(k)) saved.set(k, process.env[k]); delete process.env[k] }
    process.env['ANTHROPIC_API_KEY'] = PROBE_KEY
    process.env['REDIS_URL'] = DEAD_REDIS
    process.env['PORT'] = '3999'
    process.env['MODE'] = 'local'
    const built = await buildServer(loadConfig())
    expect(typeof built.stopIntake).toBe('function')
    expect(typeof built.closeResources).toBe('function')
    expect(typeof built.closeAll).toBe('function')
    built.stopIntake()
    await built.closeResources()
    await built.app.close()
  })
})

describe('buildServer — 플래그가 라우트를 실제로 바꾼다', () => {
  test('관측 라우트는 인증·DB 와 무관하게 항상 있다', async () => {
    await withServer({}, (routes) => {
      expect(routes).toContain('health')
      expect(routes).toContain('metrics')
    })
  })

  /**
   * 보안 불변식의 실물 확인 — 무인증 권한 엔드포인트를 만들지 않는다.
   * `SERVICE_JWT_SECRET` 이 없으면 admin DLQ 라우트를 **등록조차 하지 않는다**(fail-closed).
   * 경고 문구가 아니라 라우트 트리로 본다.
   */
  test('SERVICE_JWT_SECRET 없으면 admin DLQ 라우트가 등록되지 않는다', async () => {
    await withServer({}, (routes) => {
      expect(routes).not.toContain('redrive')
    })
  })

  test('SERVICE_JWT_SECRET 이 있으면 admin DLQ 라우트가 등록된다', async () => {
    await withServer({ SERVICE_JWT_SECRET: SERVICE_SECRET }, (routes) => {
      expect(routes).toContain('redrive')
    })
  })

  /**
   * 결정 제출 라우트는 `MANAGER_DECISION_ROUTING` + DB pool + 서비스 JWT 셋이 다 있어야 등록된다
   * (`shouldWireDecisionRoute`). 여기서는 pool 이 없으므로 **어떤 조합으로도 등록되지 않는다** —
   * 셋 중 둘만 켠 상태가 통과로 새지 않는지 본다.
   */
  test('pool 이 없으면 결정 제출 라우트는 어떤 조합에서도 등록되지 않는다', async () => {
    await withServer({ MANAGER_DECISION_ROUTING: 'true', SERVICE_JWT_SECRET: SERVICE_SECRET }, (routes) => {
      expect(routes).not.toContain('/decision')
    })
  })
})
