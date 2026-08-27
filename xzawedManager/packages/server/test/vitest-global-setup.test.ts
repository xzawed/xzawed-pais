import { describe, test, expect, afterEach, vi } from 'vitest'
import gate from './vitest-global-setup.js'

/**
 * **게이트 장치 자체의 테스트.** 이것이 틀리면 fail-closed 가 위장 초록이 된다 —
 * "skip 을 통과로 세지 않는다"를 강제하는 장치가 정작 아무것도 강제하지 않는 상태.
 *
 * 이 파일이 필요해진 이유가 실측이다. `REQUIRE_INTEGRATION=1` 은 **전 게이트**를 요구하는데
 * pg 통합 파일 36개가 도는 `turborepo` 잡에는 Redis 가 없다 — 그래서 `=1` 을 붙일 수 없었고,
 * 통합 커버리지의 대부분이 fail-closed 보호 **밖**에 있었다. 게이트별 요구를 넣으면서
 * 그 판정을 여기서 고정한다.
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

/** 경고는 stderr 로 나가므로 삼킨다 — 이 테스트가 검사하는 것은 throw 여부다. */
function run(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  gate()
}

describe('통합 게이트 — 요구하지 않으면 경고만 한다', () => {
  test('REQUIRE_INTEGRATION 미설정이면 인프라가 전혀 없어도 throw 하지 않는다', () => {
    setEnv({})
    expect(() => run()).not.toThrow()
  })

  test('빈 문자열도 미설정과 같다', () => {
    setEnv({ REQUIRE_INTEGRATION: '' })
    expect(() => run()).not.toThrow()
  })
})

describe('통합 게이트 — =1 은 전 게이트를 요구한다(기존 동작)', () => {
  test('둘 다 열려 있으면 통과', () => {
    setEnv({ REQUIRE_INTEGRATION: '1', TEST_DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' })
    expect(() => run()).not.toThrow()
  })

  test('Redis 만 없어도 throw — 인프라를 다 붙인 잡용이다', () => {
    setEnv({ REQUIRE_INTEGRATION: '1', TEST_DATABASE_URL: 'postgres://x' })
    expect(() => run()).toThrow(/redis/)
  })

  test('pg 만 없어도 throw', () => {
    setEnv({ REQUIRE_INTEGRATION: '1', REDIS_URL: 'redis://x' })
    expect(() => run()).toThrow(/pg/)
  })
})

describe('통합 게이트 — 이름 지정은 그 게이트만 요구한다', () => {
  /** turborepo 잡의 실제 구성: pg 있음 · Redis 없음. 이 조합이 통과해야 잡이 산다. */
  test('=pg 는 Redis 가 없어도 통과한다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'pg', TEST_DATABASE_URL: 'postgres://x' })
    expect(() => run()).not.toThrow()
  })

  /** **이 PR 의 목적.** 누군가 TEST_DATABASE_URL 을 빼면 36개가 조용히 skip되는 대신 죽는다. */
  test('=pg 인데 pg env 가 없으면 throw — 조용한 skip 을 막는 지점이다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'pg', REDIS_URL: 'redis://x' })
    expect(() => run()).toThrow(/pg/)
  })

  test('=pg 는 DATABASE_URL 로도 열린다(TEST_ 접두는 선택)', () => {
    setEnv({ REQUIRE_INTEGRATION: 'pg', DATABASE_URL: 'postgres://x' })
    expect(() => run()).not.toThrow()
  })

  test('=redis 는 pg 가 없어도 통과한다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'redis', REDIS_URL: 'redis://x' })
    expect(() => run()).not.toThrow()
  })

  test('콤마 목록은 나열한 것을 전부 요구한다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'pg,redis', TEST_DATABASE_URL: 'postgres://x' })
    expect(() => run()).toThrow(/redis/)
    setEnv({ REQUIRE_INTEGRATION: 'pg, redis', TEST_DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' })
    expect(() => run()).not.toThrow()
  })
})

describe('통합 게이트 — 오타는 조용히 넘어가지 않는다', () => {
  /**
   * 모르는 이름이 "아무것도 요구하지 않음"으로 떨어지면 이 장치 자체가 위장 초록이 된다.
   * `REQUIRE_INTEGRATION: "pgg"` 같은 오타가 CI 에 들어가도 아무 일도 안 일어나는 상태.
   */
  test('모르는 게이트 이름은 인프라가 다 있어도 throw 한다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'pgg', TEST_DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' })
    expect(() => run()).toThrow(/모르는 게이트 이름/)
  })

  test('유효한 이름과 섞여 있어도 잡는다', () => {
    setEnv({ REQUIRE_INTEGRATION: 'pg,postgres', TEST_DATABASE_URL: 'postgres://x' })
    expect(() => run()).toThrow(/postgres/)
  })
})
