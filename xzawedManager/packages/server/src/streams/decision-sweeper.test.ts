import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleDecisionSweep, DecisionSweeper } from './decision-sweeper.js'

describe('handleDecisionSweep', () => {
  it('만료 id들 → expireRequest 호출·expired 카운트', async () => {
    const store = {
      expiredPendingRequests: async () => ['a', 'b'],
      expireRequest: vi.fn(async () => ({ eventId: 'e' })),
    }
    expect(await handleDecisionSweep(123, { store })).toEqual({ expired: 2, skipped: 0 })
    expect(store.expireRequest).toHaveBeenCalledTimes(2)
  })
  it('expireRequest null(비-PENDING) → skipped', async () => {
    const store = { expiredPendingRequests: async () => ['a'], expireRequest: async () => null }
    expect(await handleDecisionSweep(1, { store })).toEqual({ expired: 0, skipped: 1 })
  })
  it('expireRequest throw → skipped(never-throw)', async () => {
    const store = { expiredPendingRequests: async () => ['a'], expireRequest: async () => { throw new Error('db') } }
    expect(await handleDecisionSweep(1, { store })).toEqual({ expired: 0, skipped: 1 })
  })
  it('batchLimit를 expiredPendingRequests에 전달', async () => {
    const q = vi.fn(async () => [])
    await handleDecisionSweep(1, { store: { expiredPendingRequests: q, expireRequest: async () => null }, batchLimit: 7 })
    expect(q).toHaveBeenCalledWith(1, 7)
  })
  it('expiredPendingRequests throw → {expired:0, skipped:0}(never-throw·외부 쿼리)', async () => {
    const store = { expiredPendingRequests: async () => { throw new Error('db') }, expireRequest: async () => null }
    await expect(handleDecisionSweep(1, { store })).resolves.toEqual({ expired: 0, skipped: 0 })
  })
})

describe('DecisionSweeper', () => {
  afterEach(() => { vi.useRealTimers() })
  it('pollOnce 재진입 가드(sweeping 중 재호출 noop)', async () => {
    let resolve: () => void = () => {}
    const gate = new Promise<void>((r) => { resolve = r })
    const store = { expiredPendingRequests: vi.fn(async () => { await gate; return [] }), expireRequest: async () => null }
    const s = new DecisionSweeper({ store })
    const p1 = s.pollOnce()
    await s.pollOnce() // sweeping 중 → 즉시 return(미호출)
    expect(store.expiredPendingRequests).toHaveBeenCalledTimes(1)
    resolve(); await p1
  })
  it('pollOnce throw 삼킴(never-throw)', async () => {
    const store = { expiredPendingRequests: async () => { throw new Error('x') }, expireRequest: async () => null }
    await expect(new DecisionSweeper({ store }).pollOnce()).resolves.toBeUndefined()
  })
  it('start→타이머·stop→해제', () => {
    vi.useFakeTimers()
    const store = { expiredPendingRequests: vi.fn(async () => []), expireRequest: async () => null }
    const s = new DecisionSweeper({ store }, 1000)
    s.start(); vi.advanceTimersByTime(1000); expect(store.expiredPendingRequests).toHaveBeenCalled()
    s.stop(); vi.useRealTimers()
  })
})
