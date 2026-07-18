// G8 lease 가시성 auto-tune(순수·테스트 가능). verify 채널이 켜지면 WP당 에이전트 호출이 여러 단계라
// lease 가시성 창이 짧으면 검증 도중 lease 만료(false reclaim·중복 신호·낭비)가 발생한다(W6).
// 활성 채널이 요구하는 가시성 **바닥값**을 계산해 configured 값보다 낮으면 자동 상향한다 —
// **올리기만 하고 낮추진 않는다**(개별 env가 이미 높으면 그대로). heartbeat와 함께 false reclaim를 막는다.

export interface LeaseVisibilityInput {
  configuredMs: number
  wpVerify: boolean
  wpConformance: boolean
  wpImpact: boolean
  wpProperty: boolean
  wpMutation: boolean
  wpSecurity: boolean
}

export interface LeaseVisibilityResult {
  /** 실제 사용할 가시성(configured와 채널 바닥값 중 큰 값). */
  effectiveMs: number
  /** 활성 채널이 요구하는 바닥값(채널 없으면 0). */
  floorMs: number
  /** effectiveMs가 configured보다 커졌는가(자동 상향 발생). */
  bumped: boolean
  /** 바닥값을 결정한 채널(max 요구). */
  drivers: string[]
}

const VERIFY_FLOOR_MS = 360_000 // 에이전트 타임아웃 120s × 3
const HEAVY_FLOOR_MS = 600_000 // 다단계 채널(conformance/impact/property 최대 ~5단계·mutation K-fold)

export function resolveLeaseVisibilityMs(cfg: LeaseVisibilityInput): LeaseVisibilityResult {
  const reqs: Array<[boolean, number, string]> = [
    [cfg.wpVerify, VERIFY_FLOOR_MS, 'WP_VERIFY'],
    [cfg.wpSecurity, VERIFY_FLOOR_MS, 'WP_SECURITY'],
    [cfg.wpConformance, HEAVY_FLOOR_MS, 'WP_CONFORMANCE'],
    [cfg.wpImpact, HEAVY_FLOOR_MS, 'WP_IMPACT'],
    [cfg.wpProperty, HEAVY_FLOOR_MS, 'WP_PROPERTY'],
    [cfg.wpMutation, HEAVY_FLOOR_MS, 'WP_MUTATION'],
  ]
  const enabled = reqs.filter(([on]) => on)
  const floorMs = enabled.length > 0 ? Math.max(...enabled.map(([, ms]) => ms)) : 0
  const drivers = enabled.filter(([, ms]) => ms === floorMs).map(([, , name]) => name)
  const effectiveMs = Math.max(cfg.configuredMs, floorMs)
  return { effectiveMs, floorMs, bumped: effectiveMs > cfg.configuredMs, drivers }
}
