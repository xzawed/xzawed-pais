// vitest globalSetup — 통합 테스트 게이트 관측성 + **fail-closed 모드**.
//
// **왜 Orchestrator에도 필요했나(실측).** 여기엔 globalSetup이 아예 없어서 인프라 없이 돌리면
// 경고조차 나오지 않았다. 실측: 인프라 없음 589 passed/16 skipped · DB만 598/7 · DB+Redis 605/0
// — **env 하나로 pg 9건 · Redis 7건이 갈리는데 그것이 어디에도 표시되지 않았다.**
// Manager는 최소한 경고는 했다(그리고 #647에서 fail-closed까지 붙었다). 여기는 둘 다 없었다.
//
// 게이트 목록은 서비스마다 다르고, **판정 코어는 Manager와 복제 블록이다**(M3: 서비스 간 import
// 금지 + Orchestrator는 `@xzawed/agent-streams`도 의존하지 않아 공유 경로가 없다).

/** 게이트 하나 — 어떤 env가 있으면 열리고, 없으면 무엇이 skip되는가. */
// jscpd:ignore-start
// replicated-block: integration-gate-core
// Manager의 같은 블록과 바이트 동일해야 한다. 사유와 강제 방법: scripts/check-replicated-blocks.js
interface Gate {
  /** `REQUIRE_INTEGRATION`에서 이 게이트만 골라 요구할 때 쓰는 이름. */
  readonly id: string
  readonly envs: readonly string[]
  readonly what: string
  readonly how: string
}

/**
 * `REQUIRE_INTEGRATION`이 **어느 게이트를 요구하는지** 판정한다.
 *
 * - 미설정/빈 값 → 아무것도 요구하지 않는다(경고만·기존 로컬 동작 불변).
 * - `1` → **전 게이트**. 인프라를 다 붙인 잡용.
 * - `pg` · `redis` · `pg,redis` → **그 게이트만**.
 *
 * 이름 지정을 넣은 이유가 실측이다. Manager의 pg 통합 파일이 39개 중 36개이고 그것들이 도는 곳은
 * `turborepo` 잡인데, **그 잡에는 Redis가 없어 `=1`을 붙이면 게이트가 닫혀 throw한다.** 그래서
 * 붙이지 못한 채로 남아 있었고, 결과적으로 **통합 커버리지의 대부분이 fail-closed 보호 밖**이었다.
 *
 * 모르는 이름은 **오타로 보고 throw한다** — 오타가 "아무것도 요구하지 않음"으로 조용히
 * 떨어지면 이 장치 자체가 위장 초록이 된다.
 */
function requiredGates(gates: readonly Gate[], raw: string | undefined): readonly Gate[] {
  const v = (raw ?? '').trim()
  if (v === '') return []
  if (v === '1') return gates
  const names = v.split(',').map((s) => s.trim()).filter((s) => s !== '')
  const unknown = names.filter((n) => !gates.some((g) => g.id === n))
  if (unknown.length > 0) {
    throw new Error(
      `REQUIRE_INTEGRATION에 모르는 게이트 이름: ${unknown.join(', ')}. ` +
        `쓸 수 있는 값: 1(전부) 또는 ${gates.map((g) => g.id).join('·')} 의 콤마 목록.`,
    )
  }
  return gates.filter((g) => names.includes(g.id))
}

/** 닫힌 게이트를 경고하고, **요구한** 게이트가 닫혀 있으면 throw한다. */
export function runIntegrationGate(gates: readonly Gate[]): void {
  const required = requiredGates(gates, process.env['REQUIRE_INTEGRATION'])
  const isOpen = (g: Gate): boolean => g.envs.some((e) => Boolean(process.env[e]))
  for (const gate of gates.filter((g) => !isOpen(g))) {
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
// jscpd:ignore-end

/**
 * **DB 게이트에 걸리는 것이 `*.integration.test.ts` 만이 아니다.** `auth.test.ts`·`projects.test.ts`
 * 도 `skipIf(!hasDb)` 로 묶여 있어 이름만 보면 통합 테스트인 줄 모른다 — 그래서 "통합 파일 몇 개"가
 * 아니라 **게이트가 여닫는 테스트 수**(pg 9건 · Redis 7건)로 세야 한다.
 */
export const GATES: readonly Gate[] = [
  {
    id: 'pg',
    envs: ['TEST_DATABASE_URL', 'DATABASE_URL'],
    what: 'pg 통합 테스트(마이그레이션·auth·projects 라우트 포함)',
    how: 'CI(turborepo 잡) 또는 로컬에서 DATABASE_URL 설정 후 실행하세요.',
  },
  {
    id: 'redis',
    envs: ['REDIS_URL'],
    what: 'Redis Streams 통합 테스트',
    how: 'CI(redis-integration 잡) 또는 로컬에서 REDIS_URL 설정 후 실행하세요.',
  },
]

export default function (): void {
  runIntegrationGate(GATES)
}
