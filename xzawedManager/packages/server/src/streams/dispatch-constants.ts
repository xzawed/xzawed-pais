import type { WpStatus } from '@xzawed/agent-streams'

/**
 * P1d-4 디스패치 이벤트 상수 + WP 상태 별칭.
 * 플래너(dispatch.ts)·원자 적재(dispatch.repo.ts)가 공유한다.
 *
 * **상태 값의 정본은 여기가 아니라 `@xzawed/agent-streams` 의 `types/wp-state.ts` 다**(S6.1).
 * 이 파일은 읽기 편한 별칭만 두고 값은 다시 선언하지 않는다 — 이전에는 여기서 독립 선언한
 * 대문자 집합과 shared 의 소문자 enum 이 **교집합 0** 으로 갈려 있었고, 한쪽을 읽는 술어가
 * 다른 쪽이 쓴 값을 영원히 못 보는 상태였다. `satisfies WpStatus` 가 드리프트를 tsc 로 잡는다.
 */

/** WP의 초기 논리 상태(디스패치 전이의 from). */
export const DRAFTED_STATE = 'DRAFTED' satisfies WpStatus
/** 디스패치 완료 상태(전이의 to). */
export const DISPATCHED_STATE = 'DISPATCHED' satisfies WpStatus
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
export const DONE_STATE = 'DONE' satisfies WpStatus
export const WP_COMPLETED_EVENT = 'wp.completed'
/** WP 에스컬레이션 상태(wp_state_log.to_state) + 이벤트 타입. P1d-5b. */
export const ESCALATED_STATE = 'ESCALATED' satisfies WpStatus
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
