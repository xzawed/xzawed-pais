import type { DecisionRequest, FaultAttribution } from '../db/decision.types.js'

/** lease 상한 초과로 ESCALATED된 WP 정보(handleLeaseSweep이 전달). */
export interface EscalationInfo {
  workflowId: string
  wpId: string
  attempt: number
  stepN: number
  /** C0/C1: 생성 시점 프로젝트 스코프(graph_dag.userContext.projectId). 미해석은 null. */
  projectId?: string | null
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
  projectId?: string | null
}

/** DecisionRepo의 createRequest만 의존(구조적). */
export interface DecisionBriefStore {
  createRequest(req: DecisionRequestInput): Promise<{ eventId: string } | null>
}

/**
 * §11 결정론 결함 귀속(LLM 0·N6): escalate = impl 계층 K회(maxAttempts) 정직 재시도 소진.
 * 구현으로 해소 안 됨 → 계약사슬 상위(Task/plan) 검토 신호. 상위 귀속 확정은 사람 결정(P6 라우팅).
 */
export function localizeFault(info: EscalationInfo): FaultAttribution {
  return { faultTier: 'impl_exhausted', counters: { impl: info.attempt + 1, task: 0, plan: 0 } }
}

/**
 * §15 결함 의사결정 브리프: WP 에스컬레이션(lease 상한 초과)을 **사람 결정 요청**으로 구조화한다.
 * 사람에게 위치·기대 vs 실제·선택지를 제공하고(§15), 결정은 §4 choice로 다운스트림 라우팅된다.
 * requestId는 (wf,wpId,attempt) 결정론 → 재호출 멱등(`createRequest` ON CONFLICT DO NOTHING).
 */
export function buildDefectBrief(info: EscalationInfo): DecisionRequestInput {
  const { workflowId, wpId, attempt, stepN } = info
  // attribution을 단일 출처로 산출하고 시도 횟수(tries)는 거기서 파생 — attempt+1을 한 곳에서만 계산.
  const attribution = localizeFault(info)
  const tries = attribution.counters.impl
  return {
    requestId: `${workflowId}:${wpId}:${attempt}`,
    type: 'defect_brief',
    workflowId,
    correlationId: workflowId,
    wpId,
    severity: 'blocking',
    projectId: info.projectId ?? null,
    context: {
      location: `WP ${wpId} (step ${stepN})`,
      expectedVsActual: `구현 계층에서 ${tries}회 정직 재시도 모두 검증 실패 — 구현으로 해소 불가. 계약 사슬상 Task(스펙 모호/불가능) 또는 plan(기획 모순) 검토 필요.`,
      impact: ['이 WP에 의존하는 후행 작업이 차단됨(lease escalated).'],
      evidenceRefs: [`wp.escalated@${workflowId}/${wpId}`, `attempt=${tries}`],
      options: ['fix_reverify', 'spec_fix', 'accept_known', 'reject'],
      attribution,
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
