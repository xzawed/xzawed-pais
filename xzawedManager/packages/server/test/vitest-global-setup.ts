// vitest globalSetup — 통합 테스트 게이트 관측성 + **fail-closed 모드**.
//
// `*.integration.test.ts`는 필요한 인프라 URL이 없으면 `describe.skipIf(...)`로 **조용히**
// 건너뛴다. 로컬에서 인프라 없이 `pnpm test`를 돌리면 통과처럼 보이지만 실제로는 통합 검증이
// 실행되지 않은 것이라, 전체 실행당 1회 경고한다(테스트 동작·게이트 자체는 불변).
//
// **CI에서는 경고로 부족하다.** vitest는 전부 skip돼도 exit 0이라, 통합 테스트를 지정 실행하는
// 스텝이 **아무것도 안 돌고도 초록**이 된다 — `redis-contract.integration.test.ts`가 CI 어디서도
// 실행되지 않은 채 오래 있었던 것이 정확히 이 모양이었다. `REQUIRE_INTEGRATION=1`이면 게이트가
// 열리지 않았을 때 **throw해서 런을 실패시킨다**. 인프라를 붙여 놓고 env를 빠뜨리면 시끄럽게 죽는다.

/** 게이트 하나 — 어떤 env가 있으면 열리고, 없으면 무엇이 skip되는가. */
interface Gate {
  /** `REQUIRE_INTEGRATION`에서 이 게이트만 골라 요구할 때 쓰는 이름. */
  readonly id: string
  readonly envs: readonly string[]
  readonly what: string
  readonly how: string
}

/**
 * `envs`는 **"하나라도 있으면 이 게이트의 테스트가 전부 돈다"**를 만족해야 한다.
 *
 * Redis에 `TEST_REDIS_URL`을 넣지 않는 이유가 이것이다. `redis-metrics`는
 * `TEST_REDIS_URL ?? REDIS_URL`을 보지만 `redis-contract`·`premium-profile-wiring`은
 * **`REDIS_URL`만** 본다 — `TEST_REDIS_URL`만 있으면 둘은 여전히 skip되는데 경고는 침묵한다.
 * 실제로 그렇게 만들었다가 Grok 반증이 잡았다. 관대한 게이트는 관측성을 거짓말로 만든다.
 */
const GATES: readonly Gate[] = [
  {
    id: 'pg',
    envs: ['TEST_DATABASE_URL', 'DATABASE_URL'],
    what: 'pg 통합 테스트',
    how: 'CI(turborepo 잡) 또는 로컬에서 DATABASE_URL 설정 후 실행하세요.',
  },
  {
    id: 'redis',
    envs: ['REDIS_URL'],
    what: 'Redis 통합 테스트(서비스 간 메시지 계약 포함)',
    how: 'CI(manager-redis-integration 잡) 또는 로컬에서 REDIS_URL 설정 후 실행하세요.',
  },
]

/**
 * `REQUIRE_INTEGRATION`이 **어느 게이트를 요구하는지** 판정한다.
 *
 * - 미설정/빈 값 → 아무것도 요구하지 않는다(경고만·기존 로컬 동작 불변).
 * - `1` → **전 게이트**. 인프라를 다 붙인 잡용(`manager-redis-integration`).
 * - `pg` · `redis` · `pg,redis` → **그 게이트만**.
 *
 * 이름 지정을 넣은 이유가 실측이다. pg 통합 파일이 39개 중 36개이고 그것들이 도는 곳은
 * `turborepo` 잡인데, **그 잡에는 Redis가 없어 `=1`을 붙이면 게이트가 닫혀 throw한다.**
 * 그래서 붙이지 못한 채로 남아 있었고, 결과적으로 **통합 커버리지의 대부분이 fail-closed
 * 보호 밖**이었다 — 누군가 `TEST_DATABASE_URL`을 빼면 36개가 조용히 skip되고 잡은 초록이다.
 * 이 저장소가 이미 한 번 당한 모양 그대로다(`redis-contract`가 CI 어디서도 안 돌았다).
 *
 * 모르는 이름은 **오타로 보고 throw한다** — 오타가 "아무것도 요구하지 않음"으로 조용히
 * 떨어지면 이 장치 자체가 위장 초록이 된다.
 */
function requiredGates(raw: string | undefined): readonly Gate[] {
  const v = (raw ?? '').trim()
  if (v === '') return []
  if (v === '1') return GATES
  const names = v.split(',').map((s) => s.trim()).filter((s) => s !== '')
  const unknown = names.filter((n) => !GATES.some((g) => g.id === n))
  if (unknown.length > 0) {
    throw new Error(
      `REQUIRE_INTEGRATION에 모르는 게이트 이름: ${unknown.join(', ')}. ` +
        `쓸 수 있는 값: 1(전부) 또는 ${GATES.map((g) => g.id).join('·')} 의 콤마 목록.`,
    )
  }
  return GATES.filter((g) => names.includes(g.id))
}

export default function (): void {
  const required = requiredGates(process.env['REQUIRE_INTEGRATION'])
  const isOpen = (g: Gate): boolean => g.envs.some((e) => Boolean(process.env[e]))
  const missing: Gate[] = GATES.filter((g) => !isOpen(g))
  for (const gate of missing) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n[vitest] ⚠ ${gate.envs.join('/')} 미설정 — ${gate.what}가 skip됩니다(커버리지 제외).\n` +
        `         ${gate.how}\n`,
    )
  }
  // **요구한 게이트만** 본다. 요구하지 않은 게이트가 닫혀 있는 것은 정상이다(그 잡의 관심사가 아니다).
  const violated = required.filter((g) => !isOpen(g))
  if (violated.length > 0) {
    throw new Error(
      `REQUIRE_INTEGRATION=${process.env['REQUIRE_INTEGRATION']} 인데 게이트가 닫혀 있다: ` +
        `${violated.map((g) => `${g.id}(${g.envs.join('/')})`).join(' · ')}. ` +
        '통합 테스트가 전부 skip되면 이 실행은 아무것도 검증하지 않는다 — skip을 통과로 세지 않는다.',
    )
  }
}
