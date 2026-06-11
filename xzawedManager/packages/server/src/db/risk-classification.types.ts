/**
 * P2r-2 — Wiki Agent 리스크 분류 영속 상수(단일출처). RiskClassification 아티팩트 스키마는
 * `@xzawed/agent-streams`(P2r-1 결정론 코어)에 있고, 여기서는 manager-side 이벤트/스트림/상태만 정의한다.
 * 진실원천은 manager_events(risk.approved). 승인된 분류만 라우팅을 확정한다(N6·WIKI §4 line 83).
 */
export const RISK_APPROVED_EVENT = 'risk.approved'
/** 승인은 사람 행동(actor=approver). risk.* 소비 스트림(잠정 — Supervisor :main 채널 모델·봉투에 workflowId). */
export const RISK_STREAM = 'manager:risk:main'

// 상태(가변 프로젝션). 재채점 시 pending 리셋(재승인 필요). superseded는 후속(P2r-4 라우팅 소비).
export const RISK_PENDING = 'pending'
export const RISK_APPROVED = 'approved'
