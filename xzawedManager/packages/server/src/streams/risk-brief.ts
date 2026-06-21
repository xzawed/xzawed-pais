import type { RiskClassification, RiskDimension } from '@xzawed/agent-streams'
import { RISK_DIMENSIONS } from '@xzawed/agent-streams'
import type { DecisionRequestInput } from './decision-brief.js'

export interface RiskBriefInput {
  workflowId: string
  version: number
  classification: RiskClassification
}

/**
 * C5: RiskClassification을 risk_classification DecisionRequest 입력으로 매핑(표준 DecisionContext·signoff-brief 패턴).
 * C1 카드가 그대로 렌더. requestId=(workflowId, version) 결정론 → 재발행 멱등·재채점=새 요청.
 */
export function buildRiskBrief(input: RiskBriefInput): DecisionRequestInput {
  const c = input.classification
  const dims = (RISK_DIMENSIONS as readonly RiskDimension[]).map(
    (d) => `${d}=${(c.dimensionScores[d]?.score ?? 0).toFixed(2)}`,
  )
  return {
    requestId: `${input.workflowId}:risk:${input.version}`,
    type: 'risk_classification',
    workflowId: input.workflowId,
    correlationId: input.workflowId,
    wpId: null,
    severity: 'blocking',
    projectId: c.projectId,
    context: {
      location: `리스크 분류 (v${input.version})`,
      expectedVsActual: `risk=${c.risk}. ${c.humanGate.reason}. 승인하면 라우팅 확정+wp.risk 반영, 거부하면 재분류.`,
      impact: dims,
      evidenceRefs: c.complianceFrameworks,
      options: ['approve', 'reject'],
    },
  }
}
