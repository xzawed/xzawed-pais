import type { InconsistentReason } from './decomposition-consumer.js'
import type { DecisionRequestInput } from './decision-brief.js'

const REASON_TEXT: Record<InconsistentReason, string> = {
  cycle: '작업 그래프에 순환 의존이 있어 진행할 수 없습니다',
  structural: '작업 패키지 구조 오류(중복 ID·끊긴 의존)로 진행할 수 없습니다',
  coverage: '커버리지 수렴에 실패해 진행할 수 없습니다',
}

/** inconsistent 사유를 사람 가독 메시지로 — error 메시지·브리프 공용. detail은 500자 클램프. 순수. */
export function formatInconsistentReason(reason: InconsistentReason, detail?: string): string {
  const base = `분해 불일치(${reason}): ${REASON_TEXT[reason]} — 사람 검토가 필요합니다.`
  if (detail && detail.trim().length > 0) return `${base} (${detail.slice(0, 500)})`
  return base
}

/**
 * inconsistent → decompose_inconsistent DecisionRequest 입력(C1 surface·내구·M9 감사).
 * options=['accept_known'] — 자동 재분해는 E10 후속이라 확인만(거짓 affordance 금지·D10).
 * requestId 결정론({wf}:decompose-fail) → createRequest ON CONFLICT DO NOTHING 멱등.
 */
export function buildDecomposeFailureBrief(input: {
  workflowId: string
  projectId: string
  reason: InconsistentReason
  detail?: string
}): DecisionRequestInput {
  const { workflowId, projectId, reason, detail } = input
  const detailSuffix = detail && detail.trim().length > 0 ? ` 상세: ${detail.slice(0, 500)}` : ''
  return {
    requestId: `${workflowId}:decompose-fail`,
    type: 'decompose_inconsistent',
    workflowId,
    correlationId: workflowId,
    wpId: null,
    severity: 'blocking',
    projectId,
    context: {
      location: `분해 (workflow ${workflowId})`,
      expectedVsActual: `${REASON_TEXT[reason]}.${detailSuffix} 자동 진행이 불가능해 사람 검토가 필요합니다(자동 재분해는 미지원).`,
      impact: ['이 분해의 작업 그래프가 영속되지 않아 후속 자동 실행이 진행되지 않음.'],
      evidenceRefs: [`decomposition.inconsistent@${workflowId}`, `reason=${reason}`],
      options: ['accept_known'],
    },
  }
}
