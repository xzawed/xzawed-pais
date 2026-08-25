// P5-1 릴리스 게이트(M1). 진실원천은 manager_events(wp.verified / gate.passed / gate.blocked).
// 도메인별 :main 스트림 패턴(oracle/advisory/decision/risk)과 정합.

export type ChannelName = 'tc' | 'conformance' | 'impact' | 'property' | 'mutation' | 'security' | 'design'

/**
 * 채널 결과 종류(S5.3a).
 *
 * **`skipped` 와 `not_applicable` 의 차이가 게이트를 살리고 죽인다.**
 *
 * - `passed` — 채널이 실제로 돌아 증명했다.
 * - `not_applicable` — **채널이 꺼져 있거나 이 WP 가 채널의 선언된 범위 밖이다.** 게이트를 막지
 *   않는다. `not_configured` 를 장애로 세지 않는 것과 같은 이유다.
 * - `skipped` — **대상인데 증명하지 못했다.** 게이트를 막는다. **분류하지 않은 것의 기본값이다** —
 *   새 채널이 이유를 밝히지 않으면 차단되지, 조용히 통과하지 않는다(fail-closed).
 *
 * **경계선이 하나 있고 그것을 한 번 틀렸다.** 채널을 **켰는데** 증명이 안 나온 경우(승인
 * 베이스라인 부재·스토어 미주입)는 `not_applicable` 이 **아니다** — 운영자가 증명을 요구했으므로
 * 미증명이다. 그것까지 비대상으로 묶으면 "증명을 요구해 놓고 증명 없이 통과"가 된다.
 * 판단 기준은 **누가 범위를 정했는가**다: 설정·설계가 정한 범위 밖이면 비대상, 범위 안인데
 * 재료가 없으면 미증명.
 *
 * ⚠️ **실패한 채널은 여기 오지 않는다.** 증거는 `verdict.ok` 일 때만 영속되고(`worker.ts`),
 * 실패하면 완료가 발행되지 않아 WP 가 DONE 에 못 간다. 즉 게이트의 fail-closed 는 "실패를
 * 차단 결과로 기록해서"가 아니라 "실패한 WP 는 게이트에 도달하지 않아서"다. **실패도 영속하도록
 * 바꾸면 `failed` 종류를 함께 넣어야 한다** — 안 그러면 게이트가 실패한 채널을 못 본다.
 *
 * 이전에는 `skipped` 하나뿐이었고 5개 채널이 **꺼져 있을 때도** 그것을 기록했다. 채널은 전부
 * 기본 off 이므로 릴리스 게이트를 켜면 테스트를 통과한 WP 도 "미증명 채널 5개"로 **영구 차단**됐다.
 * 채널이 켜진 채 실패하면 `verifyWp` 가 완료 자체를 발행하지 않아 WP 가 DONE 에 못 가므로,
 * 게이트가 보는 WP 는 이미 검증을 통과한 것들이다 — 거기서 비대상을 미증명으로 세는 것은
 * 이중 판정이자 오판이었다.
 */
export type ChannelOutcomeKind = 'passed' | 'skipped' | 'not_applicable'
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
