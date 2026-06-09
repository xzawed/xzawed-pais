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
  status: z.enum(['drafted', 'human_approved', 'rejected']).default('drafted'),
})
export type OracleScenario = z.infer<typeof OracleScenarioSchema>

export const OracleSchema = z.object({
  oracleId: z.string().min(1),
  workflowId: z.string().min(1),
  storyId: z.string().min(1),
  version: z.number().int().positive().default(1),
  status: z.enum(['pending', 'approved', 'superseded']).default('pending'),
  scenarios: z.array(OracleScenarioSchema).default([]),
  /** acceptance_criterion(문자열) → 그것을 덮는 scenario id 목록. */
  coverage: z.record(z.array(z.string())).default({}),
})
export type Oracle = z.infer<typeof OracleSchema>

/** §8: ≥1 human_approved 시나리오가 덮는 acceptance_criterion 집합 산출(repo→ApprovedOracleView 변환용). */
export function coveredCriteria(scenarios: OracleScenario[], coverage: Record<string, string[]>): Set<string> {
  const approvedIds = new Set(scenarios.filter((s) => s.status === SCENARIO_APPROVED).map((s) => s.id))
  const covered = new Set<string>()
  for (const [ac, scenarioIds] of Object.entries(coverage)) {
    if (scenarioIds.some((id) => approvedIds.has(id))) covered.add(ac)
  }
  return covered
}
