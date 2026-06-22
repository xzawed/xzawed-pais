import { describe, it, expect } from 'vitest'
import { desiredMode, nextMode } from '../resilience/operational-mode.js'

describe('desiredMode', () => {
  it('무신호→NORMAL·providerOpen→DEGRADED·budgetDailyTripped→SAFE·둘다→SAFE', () => {
    expect(desiredMode({})).toBe('NORMAL')
    expect(desiredMode({ providerCircuitOpen: true })).toBe('DEGRADED')
    expect(desiredMode({ budgetDailyTripped: true })).toBe('SAFE')
    expect(desiredMode({ providerCircuitOpen: true, budgetDailyTripped: true })).toBe('SAFE')
  })
})

describe('nextMode', () => {
  const W = 1000
  it('악화: NORMAL→SAFE 즉시 점프(recoveryEligibleAt null)', () => {
    const r = nextMode({ current: 'NORMAL', desired: 'SAFE', now: 0, recoveryEligibleAt: null, stabilityWindowMs: W })
    expect(r.mode).toBe('SAFE'); expect(r.changed).toBe(true); expect(r.recoveryEligibleAt).toBeNull()
  })
  it('동급: 무변', () => {
    const r = nextMode({ current: 'DEGRADED', desired: 'DEGRADED', now: 0, recoveryEligibleAt: null, stabilityWindowMs: W })
    expect(r.changed).toBe(false); expect(r.mode).toBe('DEGRADED')
  })
  it('호전 진입: 타이머 시작·머무름', () => {
    const r = nextMode({ current: 'SAFE', desired: 'NORMAL', now: 100, recoveryEligibleAt: null, stabilityWindowMs: W })
    expect(r.changed).toBe(false); expect(r.mode).toBe('SAFE'); expect(r.recoveryEligibleAt).toBe(1100)
  })
  it('호전 윈도 미경과: 유지', () => {
    const r = nextMode({ current: 'SAFE', desired: 'NORMAL', now: 500, recoveryEligibleAt: 1100, stabilityWindowMs: W })
    expect(r.changed).toBe(false); expect(r.recoveryEligibleAt).toBe(1100)
  })
  it('호전 윈도 경과: SAFE→DEGRADED 1단계·타이머 재시작(더 내려갈 단계)', () => {
    const r = nextMode({ current: 'SAFE', desired: 'NORMAL', now: 1100, recoveryEligibleAt: 1100, stabilityWindowMs: W })
    expect(r.mode).toBe('DEGRADED'); expect(r.changed).toBe(true); expect(r.recoveryEligibleAt).toBe(2100)
  })
  it('호전 마지막 단계: DEGRADED→NORMAL·타이머 null', () => {
    const r = nextMode({ current: 'DEGRADED', desired: 'NORMAL', now: 2100, recoveryEligibleAt: 2100, stabilityWindowMs: W })
    expect(r.mode).toBe('NORMAL'); expect(r.changed).toBe(true); expect(r.recoveryEligibleAt).toBeNull()
  })
  it('호전 중 악화: 즉시 점프·타이머 리셋', () => {
    const r = nextMode({ current: 'DEGRADED', desired: 'SAFE', now: 50, recoveryEligibleAt: 1100, stabilityWindowMs: W })
    expect(r.mode).toBe('SAFE'); expect(r.changed).toBe(true); expect(r.recoveryEligibleAt).toBeNull()
  })
})
