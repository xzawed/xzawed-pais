import { describe, it, expect, vi } from 'vitest'
import { ModeController } from './mode-controller.js'

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
})
