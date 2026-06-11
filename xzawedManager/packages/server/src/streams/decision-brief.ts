import type { DecisionRequest } from '../db/decision.types.js'

/** lease 상한 초과로 ESCALATED된 WP 정보(handleLeaseSweep이 전달). */
export interface EscalationInfo {
  workflowId: string
  wpId: string
  attempt: number
  stepN: number
}

/** `DecisionRepo.createRequest` 입력의 구조적 부분집합 — repo 직접 결합 회피(M3). */
export interface DecisionRequestInput {
  requestId: string
  type: DecisionRequest['type']
  workflowId: string
  correlationId: string
  wpId?: string | null
  context?: DecisionRequest['context']
  severity?: DecisionRequest['severity']
}

/** DecisionRepo의 createRequest만 의존(구조적). */
export interface DecisionBriefStore {
  createRequest(req: DecisionRequestInput): Promise<{ eventId: string } | null>
}

/**
 * §15 결함 의사결정 브리프: WP 에스컬레이션(lease 상한 초과)을 **사람 결정 요청**으로 구조화한다.
 * 사람에게 위치·기대 vs 실제·선택지를 제공하고(§15), 결정은 §4 choice로 다운스트림 라우팅된다.
 * requestId는 (wf,wpId,attempt) 결정론 → 재호출 멱등(`createRequest` ON CONFLICT DO NOTHING).
 */
export function buildDefectBrief(info: EscalationInfo): DecisionRequestInput {
  const { workflowId, wpId, attempt, stepN } = info
  return {
    requestId: `${workflowId}:${wpId}:${attempt}`,
    type: 'defect_brief',
    workflowId,
    correlationId: workflowId,
    wpId,
    severity: 'blocking',
    context: {
      location: `WP ${wpId} (step ${stepN})`,
      expectedVsActual: `WP가 ${attempt + 1}회 시도 후에도 완료되지 못함 — lease 만료·max_attempts 초과(검증/실행 반복 실패).`,
      impact: [],
      evidenceRefs: [`wp.escalated@${workflowId}`],
      options: ['fix_reverify', 'spec_fix', 'accept_known', 'reject'],
    },
  }
}

/**
 * 에스컬레이션 → DecisionRequest 핸들러. `handleLeaseSweep`의 `onEscalated`에 주입돼 escalate 성공 시
 * 결함 브리프를 영속한다(발행만 되고 사라지던 escalation을 사람 도달 핸드오프로 폐합·M8/M9).
 * throw 방어는 호출자(handleLeaseSweep)가 best-effort로 감싼다 — 브리프 부재가 sweep을 멈추지 않게.
 */
export function makeEscalationBrief(store: DecisionBriefStore): (info: EscalationInfo) => Promise<void> {
  return async (info) => {
    await store.createRequest(buildDefectBrief(info))
  }
}
