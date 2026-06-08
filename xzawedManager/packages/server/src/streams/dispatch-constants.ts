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

/** lease 상태(wp_leases.status) — active. P1d-5. */
export const LEASE_ACTIVE = 'active'
/** lease 상태 — escalated(상한 초과 사람 에스컬레이션). P1d-5b. */
export const LEASE_ESCALATED = 'escalated'
/** lease 상태 — released(WP 완료로 임대 해제). P1d-6. */
export const LEASE_RELEASED = 'released'
/** WP 완료 상태(wp_state_log.to_state) + 이벤트 타입. P1d-6. */
export const DONE_STATE = 'DONE'
export const WP_COMPLETED_EVENT = 'wp.completed'
/** WP 에스컬레이션 상태(wp_state_log.to_state) + 이벤트 타입. P1d-5b. */
export const ESCALATED_STATE = 'ESCALATED'
export const WP_ESCALATED_EVENT = 'wp.escalated'
/** lease 가시성 타임아웃 기본값(ms, 5분). env MANAGER_LEASE_VISIBILITY_MS로 오버라이드(배선 시). */
export const DEFAULT_VISIBILITY_MS = 300_000
/** 최대 디스패치 시도(초과 시 escalate). env MANAGER_LEASE_MAX_ATTEMPTS로 오버라이드(배선 시). */
export const DEFAULT_MAX_ATTEMPTS = 3

/**
 * 봉투 stepId 빌더(멱등키 §8 #1) — 멱등키를 위치(step-N)가 아니라 **WP content-hash id**에 고정한다.
 * 멱등키 = `{wf}:wp-${wpId}:${attempt}` → 재분해(topo order 변경)에 무관·attempt별 구분.
 * step-N은 이벤트 payload에 표시·정렬용(N4)으로 유지.
 */
export const wpStepId = (wpId: string): string => `wp-${wpId}`
