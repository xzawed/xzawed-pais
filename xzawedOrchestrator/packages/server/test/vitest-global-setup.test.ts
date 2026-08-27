import { describe, test, expect, afterEach, vi } from 'vitest'
import gate, { GATES } from './vitest-global-setup.js'

/**
 * **게이트 장치 자체의 테스트.** 이것이 틀리면 fail-closed 가 위장 초록이 된다.
 *
 * 판정 코어는 Manager 와 복제 블록이라 로직 전수는 그쪽 테스트가 갖는다. 여기서는
 * **이 서비스의 게이트 표가 실제 배선과 맞는지**를 본다 — 목록이 틀리면 코어가 아무리
 * 옳아도 엉뚱한 것을 요구하거나 요구하지 않는다.
 *
 * 왜 필요했나(실측): 이 패키지엔 globalSetup 이 아예 없어 인프라 부재가 **경고조차 없이**
 * 조용했다. 인프라 없음 589 passed/16 skipped · DB만 598/7 · DB+Redis 605/0 —
 * env 하나로 pg 9건·Redis 7건이 갈리는데 그것이 어디에도 표시되지 않았다.
 */
const KEYS = ['REQUIRE_INTEGRATION', 'TEST_DATABASE_URL', 'DATABASE_URL', 'REDIS_URL'] as const
const saved = new Map<string, string | undefined>()

function setEnv(env: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const k of KEYS) { if (!saved.has(k)) saved.set(k, process.env[k]); delete process.env[k] }
  for (const [k, v] of Object.entries(env)) process.env[k] = v as string
}

afterEach(() => {
  for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  saved.clear()
  vi.restoreAllMocks()
})

function run(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  gate()
}

describe('게이트 표 — 이 서비스가 실제로 쓰는 env 와 맞는가', () => {
  test('pg·redis 두 게이트만 있다', () => {
    expect(GATES.map((g) => g.id)).toEqual(['pg', 'redis'])
  })

  /** 테스트들이 `TEST_DATABASE_URL ?? DATABASE_URL` 을 보므로 둘 다 열쇠여야 한다. */
  test('pg 게이트는 TEST_DATABASE_URL 과 DATABASE_URL 둘 다로 열린다', () => {
    expect(GATES.find((g) => g.id === 'pg')?.envs).toEqual(['TEST_DATABASE_URL', 'DATABASE_URL'])
  })

  /**
   * `redis-streams.integration.test.ts` 는 `REDIS_URL` **만** 본다.
   * 여기에 `TEST_REDIS_URL` 을 더하면 그것만 있을 때 게이트는 열렸다고 하는데 테스트는 skip 된다
   * — 관대한 게이트가 관측성을 거짓말로 만드는 그 형태다(Manager 에서 실제로 겪었다).
   */
  test('redis 게이트는 REDIS_URL 만 본다', () => {
    expect(GATES.find((g) => g.id === 'redis')?.envs).toEqual(['REDIS_URL'])
  })
})

describe('게이트 동작 — 이 서비스 배선 기준', () => {
  test('REQUIRE_INTEGRATION 미설정이면 인프라가 없어도 throw 하지 않는다', () => {
    setEnv({})
    expect(() => run()).not.toThrow()
  })

  /** turborepo 잡의 실제 구성: pg 있음 · Redis 없음. */
  test('=pg 는 Redis 가 없어도 통과한다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'pg', TEST_DATABASE_URL: 'postgres://x' })
    expect(() => run()).not.toThrow()
  })

  test('=pg 인데 pg env 가 없으면 throw — 9건이 조용히 skip 되는 것을 막는 지점이다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'pg' })
    expect(() => run()).toThrow(/pg/)
  })

  /** redis-integration 잡의 실제 구성: Redis 있음 · pg 없음. */
  test('=redis 는 pg 가 없어도 통과한다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'redis', REDIS_URL: 'redis://x' })
    expect(() => run()).not.toThrow()
  })

  test('=redis 인데 REDIS_URL 이 없으면 throw — 7건이 조용히 skip 되는 것을 막는다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'redis', TEST_DATABASE_URL: 'postgres://x' })
    expect(() => run()).toThrow(/redis/)
  })

  test('모르는 이름은 인프라가 다 있어도 throw 한다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'db', TEST_DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' })
    expect(() => run()).toThrow(/모르는 게이트 이름/)
  })
})
