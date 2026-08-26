import { scoreClassification } from '@xzawed/agent-streams'
import type { ClaudeLike, RiskClassification, WpRisk, BudgetCircuitBreaker, ProviderCircuitBreaker } from '@xzawed/agent-streams'
import { runStage, buildStageCircuit } from './stages/run-stage.js'
import { buildRiskInvestigationSpec, verifyCitations, normalizeFrameworks, MAX_WP_HINTS } from './stages/risk-investigate.js'
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
  /** C5: humanGate.required 분류를 risk_classification DecisionRequest로 발행(MANAGER_RISK_DECISION).
   *  G11 Slice 4 리뷰 수정: tenantId를 seam에서 필수화(decision-brief.ts DecisionBriefStore와 동일 이유). */
  decisionStore?: { createRequest(input: DecisionRequestInput & { tenantId: string | null }): Promise<unknown> }
}

/**
 * P2r-3 생산자(best-effort·never-throw): intent → 조사(circuit-aware) → 인용 검증 → scoreClassification →
 * upsert(pending). projectId·근거 claim 부재면 skip(vacuous LOW 영속 금지). 어떤 실패도 decompose 비차단(N6 미승인).
 *
 * **`workPackages` 는 방금 분해된 WP 다**(결함 F2 · `S5.3b`). 주면 조사가 claim 별로 WP 를 지목하고
 * `wpRisks` 가 채워져 write-back 이 WP 별로 간다. 안 주면 `wpRisks` 는 비어 write-back 이
 * 아무것도 쓰지 않는다 — **프로젝트 등급을 전 WP 에 찍는 것이 F2 였으므로 그 폴백은 두지 않는다.**
 */
export async function produceRiskClassification(
  intent: string,
  workflowId: string,
  deps: RiskClassifyDeps,
  userContext?: UserContext,
  workPackages: ReadonlyArray<{ id: string; owningRole: string }> = [],
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
    const spec = buildRiskInvestigationSpec(intent, workPackages)
    const investigation = await runStage(
      { claude: deps.claude, model: deps.model, timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      spec,
      circuit,
    )
    // 프롬프트에 실린 WP 만 지목 대상이다 — 상한 밖 WP 를 지목하면 그건 환각이다(MAX_WP_HINTS).
    const wpIds = workPackages.slice(0, MAX_WP_HINTS).map((w) => w.id)
    const claims = verifyCitations(
      investigation.claims, wpIds.length > 0 ? new Set(wpIds) : undefined,
    )
    if (claims.length === 0) {
      deps.log?.('[risk] skip — 근거 claim 없음', { workflowId })
      return { classified: false }
    }
    const classification = scoreClassification({
      projectId,
      claims,
      complianceFrameworks: normalizeFrameworks(investigation.complianceFrameworks),
      // 상한 밖 WP 는 판정을 못 받는다 — write-back 이 그 자리를 **프로젝트 종합 등급**으로 채운다
      // (보수적). 예전에 여기서 방치했더니 그 WP 들이 MEDIUM 에 머물러 게이트가 조용히 꺼졌다.
      workPackageIds: wpIds,
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
