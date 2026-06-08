/**
 * P1d-4 디스패치 상태·이벤트 상수 — 단일 출처(contract-drift 회피).
 * 플래너(dispatch.ts)·원자 적재(dispatch.repo.ts)가 공유한다.
 *
 * ⚠️ 디스패치 부분 상태머신만(DRAFTED→DISPATCHED). WORKFLOW §B 전체(8+2 상태)는 후속 슬라이스가
 * 확장하며, 그때 wp_state_log CHECK 제약과 함께 정본 enum으로 통합한다.
 */

/** WP의 초기 논리 상태(디스패치 전이의 from). */
export const DRAFTED_STATE = 'DRAFTED'
/** 디스패치 완료 상태(전이의 to). */
export const DISPATCHED_STATE = 'DISPATCHED'
/** wp.dispatched 도메인 이벤트 타입(manager_events.event_type·아웃박스 메시지 type). */
export const WP_DISPATCHED_EVENT = 'wp.dispatched'
/** 디스패치 이벤트의 actor(manager_events.actor). */
export const DISPATCH_ACTOR = 'task-manager'
