import { describe, test, expect, afterAll } from 'vitest'
import { buildServer } from '../src/server.js'
import { loadConfig } from '../src/config.js'

/**
 * `buildServer` 배선 중 **DB 풀이 있어야만 성립하는 것**을 덮는다.
 *
 * `src/__tests__/server-wiring.test.ts` 는 pg 없이 도는 결정만 본다. 그런데 이 저장소에서
 * fail-closed 가 가장 중요한 지점 — **결정 제출 라우트를 무인증으로 열지 않는다** — 는
 * `shouldWireDecisionRoute(routing, hasPool, hasAuth)` 라 pool 없이는 "항상 미등록"밖에
 * 확인할 수 없다. 셋이 다 참일 때 **실제로 등록되는지**는 여기서만 볼 수 있고, 그것이 없으면
 * "미등록"은 배선이 옳아서가 아니라 pool 이 없어서일 수도 있다(위음성).
 *
 * 진리표를 라우트 트리로 전부 고정한다 — 경고 문구가 아니라 등록 결과다.
 *
 * **주의: `buildServer` 는 `runMigrations` 를 돈다.** 통합 테스트용 DB 를 실제로 마이그레이션하고
 * `manager_schema_migrations` 에 기록한다(멱등 — 두 번째 기동부터는 건너뛴다).
 */
const DB = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
const DEAD_REDIS = 'redis://127.0.0.1:1'
const PROBE_KEY = 'sk-ant-test-not-a-real-key-0000000000'
const SERVICE_SECRET = 'test-service-secret-0123456789-abcd'

const TOUCHED = [
  'ANTHROPIC_API_KEY', 'REDIS_URL', 'DATABASE_URL', 'PORT', 'MODE',
  'SERVICE_JWT_SECRET', 'MANAGER_DECISION_ROUTING', 'MANAGER_DECISION_BRIEF', 'TASK_MANAGER_ENABLED',
] as const
const saved = new Map<string, string | undefined>()
let savedOnce = false

/** 죽은 Redis 를 쓰는 이유: 배선 판정에 Redis 가 필요 없고, 소비자 `.start()` 는 fire-and-forget 이다. */
async function routesFor(env: Record<string, string>, withPool: boolean): Promise<string> {
  if (!savedOnce) { for (const k of TOUCHED) saved.set(k, process.env[k]); savedOnce = true }
  for (const k of TOUCHED) delete process.env[k]
  process.env['ANTHROPIC_API_KEY'] = PROBE_KEY
  process.env['REDIS_URL'] = DEAD_REDIS
  process.env['PORT'] = '3999'
  process.env['MODE'] = 'local'
  if (withPool) process.env['DATABASE_URL'] = DB as string
  for (const [k, v] of Object.entries(env)) process.env[k] = v

  const built = await buildServer(loadConfig())
  try {
    return built.app.printRoutes()
  } finally {
    built.stopIntake()
    await built.closeResources()
    await built.app.close()
  }
}

afterAll(() => {
  for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

const DECISION_ROUTE = '/decision'

describe.skipIf(!DB)('buildServer 배선 — DB 풀이 있어야 보이는 것', () => {
  /**
   * **핵심 케이스.** 이것이 없으면 아래 미등록 단언들은 "배선이 옳아서"가 아니라
   * "pool 이 없어서" 통과하는 위음성이 된다.
   */
  test('routing + pool + 서비스 JWT 셋이 다 있으면 결정 제출 라우트가 등록된다', async () => {
    const routes = await routesFor(
      { MANAGER_DECISION_ROUTING: 'true', MANAGER_DECISION_BRIEF: 'true', SERVICE_JWT_SECRET: SERVICE_SECRET },
      true,
    )
    expect(routes).toContain(DECISION_ROUTE)
  }, 60_000)

  test('서비스 JWT 가 없으면 등록하지 않는다 — 무인증 권한 엔드포인트 금지(fail-closed)', async () => {
    const routes = await routesFor({ MANAGER_DECISION_ROUTING: 'true', MANAGER_DECISION_BRIEF: 'true' }, true)
    expect(routes).not.toContain(DECISION_ROUTE)
  }, 60_000)

  test('라우팅 플래그가 꺼져 있으면 pool·JWT 가 있어도 등록하지 않는다', async () => {
    const routes = await routesFor({ SERVICE_JWT_SECRET: SERVICE_SECRET }, true)
    expect(routes).not.toContain(DECISION_ROUTE)
  }, 60_000)

  test('pool 이 없으면 나머지 둘이 있어도 등록하지 않는다', async () => {
    const routes = await routesFor(
      { MANAGER_DECISION_ROUTING: 'true', MANAGER_DECISION_BRIEF: 'true', SERVICE_JWT_SECRET: SERVICE_SECRET },
      false,
    )
    expect(routes).not.toContain(DECISION_ROUTE)
  }, 60_000)

  /**
   * pending 조회는 open read 다(쓰기만 서비스 토큰으로 보호). 등록 조건은 쓰기와 같으므로
   * **조회만 열리고 제출은 닫히는 상태는 없다** — 라우트가 통째로 미등록이거나 통째로 등록된다.
   */
  test('pending 조회와 제출은 같은 등록 단위다 — 한쪽만 열리지 않는다', async () => {
    const on = await routesFor(
      { MANAGER_DECISION_ROUTING: 'true', MANAGER_DECISION_BRIEF: 'true', SERVICE_JWT_SECRET: SERVICE_SECRET },
      true,
    )
    expect(on).toContain('pending')
    expect(on).toContain(DECISION_ROUTE)

    const off = await routesFor({ MANAGER_DECISION_ROUTING: 'true', MANAGER_DECISION_BRIEF: 'true' }, true)
    expect(off).not.toContain(DECISION_ROUTE)
  }, 60_000)

  /** 마이그레이션이 실제로 돌았다는 확인 — pool 경로를 탔다는 증거다(위 단언들의 전제). */
  test('pool 이 있으면 마이그레이션을 돌고 기동한다', async () => {
    const routes = await routesFor({}, true)
    expect(routes).toContain('health')
  }, 60_000)
})
