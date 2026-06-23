import type { DecisionRequestInput } from './decision-brief.js'

export interface OracleBriefInput {
  workflowId: string
  projectId: string | null
  storyCount: number
}

/**
 * C3: draft 오라클 승인을 oracle_approval DecisionRequest로 매핑(표준 DecisionContext·risk-brief 패턴).
 * C1 카드가 그대로 렌더. requestId={wf}:oracle 결정론 → createRequest ON CONFLICT 멱등.
 */
export function buildOracleBrief(input: OracleBriefInput): DecisionRequestInput {
  return {
    requestId: `${input.workflowId}:oracle`,
    type: 'oracle_approval',
    workflowId: input.workflowId,
    correlationId: input.workflowId,
    wpId: null,
    severity: 'blocking',
    projectId: input.projectId,
    context: {
      location: `오라클 승인 (${input.storyCount} 스토리)`,
      expectedVsActual: `자동 생성된 GWT 오라클 ${input.storyCount}건. 승인하면 모든 스토리의 오라클이 human_approved로 전이되어 DoR을 충족하고 디스패치가 열립니다. 거부하면 보류됩니다.`,
      impact: [],
      evidenceRefs: [],
      options: ['approve', 'reject'],
    },
  }
}
