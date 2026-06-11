import { createHash } from 'node:crypto'
import { z } from 'zod'

export const ORACLE_APPROVED_EVENT = 'oracle.approved'
export const ORACLE_ACTOR = 'oracle-approval'
export const ORACLE_PENDING = 'pending'
export const ORACLE_APPROVED = 'approved'
export const SCENARIO_APPROVED = 'human_approved'
/** oracle.approved 소비 스트림(잠정 — Supervisor :main 채널 모델). 봉투에 workflowId. */
export const ORACLE_STREAM = 'manager:oracle:main'

export const OracleScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  /** Gherkin Given-When-Then(behavior-first). 사람 검토용 — satisfied-set은 status+coverage만 소비.
   *  thenSteps=Gherkin 'Then' 절. 속성명 `then`은 객체를 thenable로 만들어(await/Promise 오인) 피한다. */
  given: z.array(z.string()).default([]),
  when: z.string().default(''),
  thenSteps: z.array(z.string()).default([]),
  status: z.enum(['drafted', 'human_approved', 'rejected']).default('drafted'),
})
export type OracleScenario = z.infer<typeof OracleScenarioSchema>

/** §4 Invariant — 속성 기반(property-based 테스트로 컴파일). 사람 검토용·human_approved만 게이트 계수.
 *  현재 영속 스키마만(검증 미소비) — property-based 컴파일·게이트 계수는 후속(impact/mutation 슬라이스). */
export const OracleInvariantSchema = z.object({
  id: z.string().min(1),
  statement: z.string().default(''),
  domain: z.string().default(''),
  property: z.string().default(''),
  status: z.enum(['drafted', 'human_approved', 'rejected']).default('drafted'),
})
export type OracleInvariant = z.infer<typeof OracleInvariantSchema>

/** §5 Golden reference — 사람 사인오프 시점의 정규화된 기준 출력(impact 채널 differential 베이스라인).
 *  normalizer로 비결정 필드(타임스탬프·id) 제거. 신규 골든 버전은 사람 승인만(N7) — 현재 영속 스키마만. */
export const OracleGoldenSchema = z.object({
  id: z.string().min(1),
  inputFixture: z.string().default(''),
  normalizedOutput: z.string().default(''),
  normalizers: z.array(z.string()).default([]),
  frozenAt: z.string().default(''),
  frozenBy: z.string().nullable().default(null),
  fromDecision: z.string().nullable().default(null),
  version: z.number().int().positive().default(1),
})
export type OracleGolden = z.infer<typeof OracleGoldenSchema>

export const OracleSchema = z.object({
  oracleId: z.string().min(1),
  workflowId: z.string().min(1),
  storyId: z.string().min(1),
  version: z.number().int().positive().default(1),
  status: z.enum(['pending', 'approved', 'superseded']).default('pending'),
  scenarios: z.array(OracleScenarioSchema).default([]),
  /** §4 속성 기반 불변식(additive·기본 [] — P3 회귀 0). */
  invariants: z.array(OracleInvariantSchema).default([]),
  /** §5 골든 기준 출력(additive·기본 [] — impact 채널이 differential 베이스라인으로 소비). */
  goldenRefs: z.array(OracleGoldenSchema).default([]),
  /** acceptance_criterion(문자열) → 그것을 덮는 scenario id 목록. */
  coverage: z.record(z.array(z.string())).default({}),
})
export type Oracle = z.infer<typeof OracleSchema>

/** P7 초안(한 story). oracleId는 영속 시 oracleIdFor(workflowId, storyId)로 파생. */
export const OracleDraftSchema = z.object({
  storyId: z.string().min(1),
  scenarios: z.array(OracleScenarioSchema).default([]),
  coverage: z.record(z.array(z.string())).default({}),
})
export type OracleDraft = z.infer<typeof OracleDraftSchema>

/** §8: ≥1 human_approved 시나리오가 덮는 acceptance_criterion 집합 산출(repo→ApprovedOracleView 변환용). */
export function coveredCriteria(scenarios: OracleScenario[], coverage: Record<string, string[]>): Set<string> {
  const approvedIds = new Set(scenarios.filter((s) => s.status === SCENARIO_APPROVED).map((s) => s.id))
  const covered = new Set<string>()
  for (const [ac, scenarioIds] of Object.entries(coverage)) {
    if (scenarioIds.some((id) => approvedIds.has(id))) covered.add(ac)
  }
  return covered
}

/**
 * 충돌-회피 oracleId 파생: workflowId·storyId를 길이-prefix(`${len}:`)로 구분해 해싱(가변 길이 경계 모호성 제거,
 * Codex#1·D1). 제어문자 리터럴 없이 명시적 escape — `(a-b,c)`↔`(a,b-c)` 충돌 차단.
 */
export function oracleIdFor(workflowId: string, storyId: string): string {
  const h = createHash('sha256').update(`${workflowId.length}:${workflowId}:${storyId}`).digest('hex').slice(0, 32)
  return `oracle-${h}`
}
