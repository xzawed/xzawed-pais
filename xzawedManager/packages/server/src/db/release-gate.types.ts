// P5-1 릴리스 게이트(M1). 진실원천은 manager_events(wp.verified / gate.passed / gate.blocked).
// 도메인별 :main 스트림 패턴(oracle/advisory/decision/risk)과 정합.

export type ChannelName = 'tc' | 'conformance' | 'impact' | 'property' | 'mutation' | 'security'
export type ChannelOutcomeKind = 'passed' | 'skipped'
export interface ChannelOutcome {
  channel: ChannelName
  outcome: ChannelOutcomeKind
}

/** 게이트가 본 WP별 판정. unverifiable=검증 증거 없음(비-develop_code/미영속) → categorically un-proven. */
export interface WpGateView {
  wpId: string
  proven: boolean
  unverifiable: boolean
  missingChannels: ChannelName[]
}
export interface ReleaseGateResult {
  status: 'passed' | 'blocked'
  perWp: WpGateView[]
  blockingReasons: string[]
}

export const WP_VERIFIED_EVENT = 'wp.verified'
export const GATE_PASSED_EVENT = 'gate.passed'
export const GATE_BLOCKED_EVENT = 'gate.blocked'
export const RELEASE_GATE_STREAM = 'manager:release:main'
/** 게이트 평가는 시스템 행동(사람 아님). */
export const RELEASE_GATE_ACTOR = 'release-gate'
