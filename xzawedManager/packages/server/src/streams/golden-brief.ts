import type { DecisionRequestInput } from './decision-brief.js'

export interface GoldenBriefInput {
  workflowId: string
  projectId: string | null
  goldenCount: number
}

/**
 * Slice 1: golden freeze 사인오프를 golden_diff DecisionRequest로 매핑(표준 DecisionContext·C3 oracle-brief 패턴).
 * C1 카드가 그대로 렌더. requestId={wf}:golden 결정론 → createRequest ON CONFLICT 멱등.
 */
export function buildGoldenBrief(input: GoldenBriefInput): DecisionRequestInput {
  return {
    requestId: `${input.workflowId}:golden`,
    type: 'golden_diff',
    workflowId: input.workflowId,
    correlationId: input.workflowId,
    wpId: null,
    severity: 'blocking',
    projectId: input.projectId,
    context: {
      location: `골든 사인오프 (${input.goldenCount} 골든)`,
      expectedVsActual: `사인오프 대기 중인 골든 기준 출력 ${input.goldenCount}건. 승인하면 모든 골든이 frozen으로 전이되어 impact 채널이 differential 베이스라인으로 소비합니다(사람이 정답이라 확인한 출력). 거부하면 보류됩니다.`,
      impact: [],
      evidenceRefs: [],
      options: ['approve', 'reject'],
    },
  }
}
