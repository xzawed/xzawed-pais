import { scoreClassification } from '@xzawed/agent-streams'
import type { ClaudeLike, RiskClassification, WpRisk, BudgetCircuitBreaker, ProviderCircuitBreaker } from '@xzawed/agent-streams'
import { runStage, buildStageCircuit } from './stages/run-stage.js'
import { buildRiskInvestigationSpec, verifyCitations, normalizeFrameworks } from './stages/risk-investigate.js'
import type { UserContext } from '../types/user-context.js'
import { buildRiskBrief } from '../streams/risk-brief.js'
import type { DecisionRequestInput } from '../streams/decision-brief.js'

const DEFAULT_TIMEOUT_MS = 120_000

/** RiskClassificationRepo.upsert만 좁게 — 테스트 mock·결합 최소. */
export interface RiskUpsertPort {
  upsert(input: { workflowId: string; classification: RiskClassification; tenantId: string | null }): Promise<{ version: number }>
}

export interface RiskClassifyDeps {
  claude: ClaudeLike
  model: string
  timeoutMs?: number
  repo: RiskUpsertPort
  budget?: BudgetCircuitBreaker
  provider?: ProviderCircuitBreaker
  isProviderFailure?: (err: unknown) => boolean
  now?: () => number
  log?: (msg: string, data?: Record<string, unknown>) => void
  /** C5: humanGate.required 분류를 risk_classification DecisionRequest로 발행(MANAGER_RISK_DECISION). */
  decisionStore?: { createRequest(input: DecisionRequestInput): Promise<unknown> }
}

/**
 * P2r-3 생산자(best-effort·never-throw): intent → 조사(circuit-aware) → 인용 검증 → scoreClassification →
 * upsert(pending). projectId·근거 claim 부재면 skip(vacuous LOW 영속 금지). 어떤 실패도 decompose 비차단(N6 미승인).
 */
export async function produceRiskClassification(
  intent: string,
  workflowId: string,
  deps: RiskClassifyDeps,
  userContext?: UserContext,
): Promise<{ classified: boolean; risk?: WpRisk }> {
  const projectId = userContext?.projectId
  if (!projectId) {
    deps.log?.('[risk] skip — projectId 없음', { workflowId })
    return { classified: false }
  }
  try {
    const circuit = buildStageCircuit(workflowId, {
      ...(deps.budget && { budget: deps.budget }),
      ...(deps.provider && { provider: deps.provider }),
      ...(deps.isProviderFailure && { isProviderFailure: deps.isProviderFailure }),
    })
    const spec = buildRiskInvestigationSpec(intent)
    const investigation = await runStage(
      { claude: deps.claude, model: deps.model, timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      spec,
      circuit,
    )
    const claims = verifyCitations(investigation.claims)
    if (claims.length === 0) {
      deps.log?.('[risk] skip — 근거 claim 없음', { workflowId })
      return { classified: false }
    }
    const classification = scoreClassification({
      projectId,
      claims,
      complianceFrameworks: normalizeFrameworks(investigation.complianceFrameworks),
    })
    const { version } = await deps.repo.upsert({ workflowId, classification, tenantId: userContext?.tenantId ?? null })
    if (classification.humanGate.required && deps.decisionStore) {
      await deps.decisionStore.createRequest({
        ...buildRiskBrief({ workflowId, version, classification }),
        tenantId: userContext?.tenantId ?? null,
      })
    }
    deps.log?.('[risk] 분류 영속(pending)', { workflowId, risk: classification.risk, humanGate: classification.humanGate.required })
    return { classified: true, risk: classification.risk }
  } catch (err) {
    deps.log?.('[risk] skip — 오류', { workflowId, error: err instanceof Error ? err.message : String(err) })
    return { classified: false }
  }
}
