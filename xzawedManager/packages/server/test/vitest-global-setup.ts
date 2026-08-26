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
    envs: ['TEST_DATABASE_URL', 'DATABASE_URL'],
    what: 'pg 통합 테스트',
    how: 'CI(turborepo 잡) 또는 로컬에서 DATABASE_URL 설정 후 실행하세요.',
  },
  {
    envs: ['REDIS_URL'],
    what: 'Redis 통합 테스트(서비스 간 메시지 계약 포함)',
    how: 'CI(manager-redis-integration 잡) 또는 로컬에서 REDIS_URL 설정 후 실행하세요.',
  },
]

export default function (): void {
  const strict = process.env['REQUIRE_INTEGRATION'] === '1'
  const missing: Gate[] = GATES.filter((g) => !g.envs.some((e) => Boolean(process.env[e])))
  for (const gate of missing) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n[vitest] ⚠ ${gate.envs.join('/')} 미설정 — ${gate.what}가 skip됩니다(커버리지 제외).\n` +
        `         ${gate.how}\n`,
    )
  }
  if (strict && missing.length > 0) {
    throw new Error(
      `REQUIRE_INTEGRATION=1 인데 게이트가 닫혀 있다: ${missing.map((g) => g.envs.join('/')).join(' · ')}. ` +
        '통합 테스트가 전부 skip되면 이 실행은 아무것도 검증하지 않는다 — skip을 통과로 세지 않는다.',
    )
  }
}
