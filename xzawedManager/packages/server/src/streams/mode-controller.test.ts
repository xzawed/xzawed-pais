import { describe, it, expect, vi } from 'vitest'
import { ModeController, shouldEnforceDegraded } from './mode-controller.js'

describe('ModeController', () => {
  it('provider open 신호 → tick에서 NORMAL→DEGRADED 전이·onTransition 호출', async () => {
    const onTransition = vi.fn()
    let now = 0
    const c = new ModeController(
      { signals: () => ({ providerCircuitOpen: true }), stabilityWindowMs: 1000, onTransition },
      100,
      () => now,
    )
    await c.pollOnce()
    expect(c.getMode()).toBe('DEGRADED')
    expect(onTransition).toHaveBeenCalledWith('NORMAL', 'DEGRADED', expect.any(String))
  })

  it('신호 무변(NORMAL) → 미전이·onTransition 미호출', async () => {
    const onTransition = vi.fn()
    const c = new ModeController(
      { signals: () => ({}), stabilityWindowMs: 1000, onTransition },
      100,
      () => 0,
    )
    await c.pollOnce()
    expect(c.getMode()).toBe('NORMAL')
    expect(onTransition).not.toHaveBeenCalled()
  })

  it('히스테리시스: SAFE 후 신호 해소 → 윈도 전 유지, 경과 후 1단계씩 복귀', async () => {
    let now = 0
    let open = true
    let safe = true
    const c = new ModeController(
      {
        signals: () => ({ providerCircuitOpen: open, budgetDailyTripped: safe }),
        stabilityWindowMs: 1000,
      },
      100,
      () => now,
    )
    await c.pollOnce()
    expect(c.getMode()).toBe('SAFE')

    safe = false
    open = false // 신호 해소
    now = 100
    await c.pollOnce()
    expect(c.getMode()).toBe('SAFE') // 윈도 전 유지

    now = 1100
    await c.pollOnce()
    expect(c.getMode()).toBe('DEGRADED') // 1단계 복귀

    now = 2200
    await c.pollOnce()
    expect(c.getMode()).toBe('NORMAL') // 마지막 단계
  })

  it('signals throw → never-throw(pollOnce가 onError로 흡수·모드 보존)', async () => {
    const c = new ModeController(
      {
        signals: () => {
          throw new Error('boom')
        },
        stabilityWindowMs: 1000,
      },
      100,
      () => 0,
    )
    await expect(c.pollOnce()).resolves.toBeUndefined()
    expect(c.getMode()).toBe('NORMAL')
  })

  it('P5-3b: SAFE 이탈 전이(SAFE→DEGRADED)에 onRecover 1회 호출', async () => {
    let now = 0
    let safe = true
    const onRecover = vi.fn()
    const c = new ModeController(
      { signals: () => ({ budgetDailyTripped: safe }), stabilityWindowMs: 1000, onRecover },
      100,
      () => now,
    )
    await c.pollOnce()
    expect(c.getMode()).toBe('SAFE')
    expect(onRecover).not.toHaveBeenCalled()
    // 신호 해소 → recoveryEligibleAt 설정 대기 틱
    safe = false
    now = 100
    await c.pollOnce() // recoveryEligibleAt = 100+1000 = 1100 으로 설정(모드 미전이)
    expect(c.getMode()).toBe('SAFE')
    expect(onRecover).not.toHaveBeenCalled()
    // 히스테리시스 윈도 경과 → SAFE→DEGRADED(from==='SAFE')
    now = 1100
    await c.pollOnce()
    expect(c.getMode()).toBe('DEGRADED')
    expect(onRecover).toHaveBeenCalledTimes(1)
  })

  it('P5-3b: SAFE 외 전이(NORMAL→DEGRADED)는 onRecover 미호출', async () => {
    const onRecover = vi.fn()
    const c = new ModeController(
      { signals: () => ({ providerCircuitOpen: true }), stabilityWindowMs: 1000, onRecover },
      100,
      () => 0,
    )
    await c.pollOnce() // NORMAL→DEGRADED(from==='NORMAL')
    expect(c.getMode()).toBe('DEGRADED')
    expect(onRecover).not.toHaveBeenCalled()
  })

  it('P5-3b: onRecover throw → never-throw(pollOnce 흡수·모드 갱신 보존)', async () => {
    let now = 0
    let safe = true
    const c = new ModeController(
      { signals: () => ({ budgetDailyTripped: safe }), stabilityWindowMs: 1000, onRecover: () => { throw new Error('boom') } },
      100,
      () => now,
    )
    await c.pollOnce()
    // 신호 해소 → recoveryEligibleAt 설정 대기 틱
    safe = false
    now = 100
    await c.pollOnce()
    // 히스테리시스 윈도 경과 → SAFE→DEGRADED(onRecover throws 이전 모드 갱신)
    now = 1100
    await expect(c.pollOnce()).resolves.toBeUndefined()
    expect(c.getMode()).toBe('DEGRADED') // 모드는 갱신됨(콜백 throw 전)
  })
})

describe('shouldEnforceDegraded', () => {
  it('enforce + modeEnabled 둘 다여야 true', () => {
    expect(shouldEnforceDegraded(true, true)).toBe(true)
    expect(shouldEnforceDegraded(true, false)).toBe(false)
    expect(shouldEnforceDegraded(false, true)).toBe(false)
    expect(shouldEnforceDegraded(false, false)).toBe(false)
  })
})
