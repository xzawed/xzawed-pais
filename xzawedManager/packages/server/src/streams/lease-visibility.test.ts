import { describe, it, expect } from 'vitest'
import { resolveLeaseVisibilityMs } from './lease-visibility.js'

const base = {
  configuredMs: 300_000,
  wpVerify: false, wpConformance: false, wpImpact: false,
  wpProperty: false, wpMutation: false, wpSecurity: false,
}

describe('resolveLeaseVisibilityMs (G8 auto-tune)', () => {
  it('활성 채널 없으면 바닥 0·configured 유지(회귀 0)', () => {
    const r = resolveLeaseVisibilityMs(base)
    expect(r).toEqual({ effectiveMs: 300_000, floorMs: 0, bumped: false, drivers: [] })
  })

  it('WP_VERIFY만 + 300s → 360s로 자동 상향', () => {
    const r = resolveLeaseVisibilityMs({ ...base, wpVerify: true })
    expect(r.effectiveMs).toBe(360_000)
    expect(r.bumped).toBe(true)
    expect(r.drivers).toContain('WP_VERIFY')
  })

  it('WP_SECURITY도 360s 바닥', () => {
    expect(resolveLeaseVisibilityMs({ ...base, wpSecurity: true }).effectiveMs).toBe(360_000)
  })

  it('heavy 채널(conformance/impact/property/mutation)은 600s 바닥', () => {
    for (const k of ['wpConformance', 'wpImpact', 'wpProperty', 'wpMutation'] as const) {
      const r = resolveLeaseVisibilityMs({ ...base, wpVerify: true, [k]: true })
      expect(r.effectiveMs).toBe(600_000)
      expect(r.bumped).toBe(true)
    }
  })

  it('configured가 이미 높으면 유지(낮추지 않음)', () => {
    const r = resolveLeaseVisibilityMs({ ...base, configuredMs: 900_000, wpConformance: true })
    expect(r.effectiveMs).toBe(900_000)
    expect(r.bumped).toBe(false)
  })

  it('drivers는 바닥값(max)을 만드는 채널만 — verify(360)는 conformance(600)와 함께면 제외', () => {
    const r = resolveLeaseVisibilityMs({ ...base, wpVerify: true, wpConformance: true })
    expect(r.floorMs).toBe(600_000)
    expect(r.drivers).toEqual(['WP_CONFORMANCE'])
    expect(r.drivers).not.toContain('WP_VERIFY')
  })
})
