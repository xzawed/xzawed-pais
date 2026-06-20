import { describe, it, expect, vi } from 'vitest'
import { planReclaim, handleLeaseSweep, type SweepDeps } from './lease.js'
import type { LeaseRecord } from '../db/lease.repo.js'

const lease = (wpId: string, attempt: number, over: Partial<LeaseRecord> = {}): LeaseRecord => ({
  workflowId: 'wf-1', wpId, attempt, owner: null, status: 'active', expiresAt: 0, stepN: 0, eventId: null, ...over,
})

describe('planReclaim (순수)', () => {
  it('nextAttempt < maxAttempts면 reclaim, 아니면 escalate', () => {
    const out = planReclaim([lease('a', 0), lease('b', 1), lease('c', 2)], { maxAttempts: 3 })
    expect(out).toEqual([
      { workflowId: 'wf-1', wpId: 'a', stepN: 0, attempt: 0, nextAttempt: 1, action: 'reclaim' },
      { workflowId: 'wf-1', wpId: 'b', stepN: 0, attempt: 1, nextAttempt: 2, action: 'reclaim' },
      { workflowId: 'wf-1', wpId: 'c', stepN: 0, attempt: 2, nextAttempt: 3, action: 'escalate' },
    ])
  })

  it('빈 입력 → []', () => {
    expect(planReclaim([], { maxAttempts: 3 })).toEqual([])
  })

  it('maxAttempts=1이면 attempt 0도 즉시 escalate', () => {
    expect(planReclaim([lease('a', 0)], { maxAttempts: 1 })[0]?.action).toBe('escalate')
  })

  it('입력 순서를 보존한다', () => {
    expect(planReclaim([lease('z', 0), lease('a', 0)], { maxAttempts: 3 }).map((i) => i.wpId)).toEqual(['z', 'a'])
  })
})

function makeSweepDeps(expired: LeaseRecord[], extra: Partial<SweepDeps> = {}) {
  const recordReclaim = vi.fn().mockResolvedValue({ status: 'reclaimed', eventId: 'r1', seq: 1 })
  const recordEscalation = vi.fn().mockResolvedValue({ status: 'escalated', eventId: 'x1', seq: 2 })
  const store = { expiredActiveLeases: vi.fn().mockResolvedValue(expired), recordReclaim, recordEscalation }
  const deps = { store, ...extra } as unknown as SweepDeps
  return { deps, recordReclaim, recordEscalation, store }
}

describe('handleLeaseSweep', () => {
  it('만료 lease를 reclaim/escalate로 분류해 store를 호출하고 outcome을 매핑한다', async () => {
    const { deps, recordReclaim, recordEscalation } = makeSweepDeps([lease('a', 0), lease('c', 2)], { maxAttempts: 3 })
    const out = await handleLeaseSweep(1000, deps)
    expect(recordReclaim).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'wf-1', wpId: 'a', nextAttempt: 1, visibilityMs: expect.any(Number),
    }))
    expect(recordEscalation).toHaveBeenCalledWith(expect.objectContaining({ wpId: 'c', attempt: 2 }))
    expect(out.reclaimed).toEqual([{ workflowId: 'wf-1', wpId: 'a', nextAttempt: 1, eventId: 'r1' }])
    expect(out.escalated).toEqual([{ workflowId: 'wf-1', wpId: 'c', eventId: 'x1' }])
    expect(out.skipped).toBe(0)
  })

  it('recordReclaim이 skipped면 reclaimed에서 제외하고 skipped로 센다(동시 sweep)', async () => {
    const { deps } = makeSweepDeps([lease('a', 0)], { maxAttempts: 3 })
    deps.store.recordReclaim = vi.fn().mockResolvedValue({ status: 'skipped' })
    const out = await handleLeaseSweep(1000, deps)
    expect(out.reclaimed).toEqual([])
    expect(out.skipped).toBe(1)
  })

  it('만료가 없으면 빈 outcome', async () => {
    const { deps } = makeSweepDeps([])
    expect(await handleLeaseSweep(1000, deps)).toEqual({ reclaimed: [], escalated: [], skipped: 0 })
  })

  it('expiredActiveLeases에 sweep now를 전달한다', async () => {
    const { deps, store } = makeSweepDeps([])
    await handleLeaseSweep(4242, deps)
    expect(store.expiredActiveLeases).toHaveBeenCalledWith(4242)
  })
})

describe('handleLeaseSweep 트리거 신호 (P4-1)', () => {
  it('publish 주입 시 reclaim 후 wp.dispatch_signal 발행(attempt=nextAttempt)', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const { deps } = makeSweepDeps([lease('a', 0)], { maxAttempts: 3, publish })
    await handleLeaseSweep(1000, deps)
    const call = publish.mock.calls.find((c) => c[0] === 'manager:dispatched:main')
    expect(call?.[1]).toMatchObject({ type: 'wp.dispatch_signal', payload: { wpId: 'a', attempt: 1 } })
  })

  it('escalate면 신호 없음', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const { deps } = makeSweepDeps([lease('a', 2)], { maxAttempts: 3, publish }) // nextAttempt=3 >= maxAttempts → escalate
    await handleLeaseSweep(1000, deps)
    expect(publish.mock.calls.find((c) => c[0] === 'manager:dispatched:main')).toBeUndefined()
  })

  it('publish 미주입이면 신호 없음(회귀 0)', async () => {
    const { deps } = makeSweepDeps([lease('a', 0)], { maxAttempts: 3 })
    const out = await handleLeaseSweep(1000, deps)
    expect(out.reclaimed.length).toBe(1)
  })
})

describe('handleLeaseSweep onEscalated (P6 결함 브리프)', () => {
  it('escalate 성공 시 onEscalated를 (wf,wpId,attempt,stepN)으로 호출', async () => {
    const onEscalated = vi.fn().mockResolvedValue(undefined)
    const { deps } = makeSweepDeps([lease('c', 2, { stepN: 5 })], { maxAttempts: 3, onEscalated })
    await handleLeaseSweep(1000, deps)
    expect(onEscalated).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-1', wpId: 'c', attempt: 2, stepN: 5 }))
  })

  it('reclaim은 onEscalated를 호출하지 않음', async () => {
    const onEscalated = vi.fn().mockResolvedValue(undefined)
    const { deps } = makeSweepDeps([lease('a', 0)], { maxAttempts: 3, onEscalated })
    await handleLeaseSweep(1000, deps)
    expect(onEscalated).not.toHaveBeenCalled()
  })

  it('escalate가 skipped(동시 sweep)면 onEscalated 미호출', async () => {
    const onEscalated = vi.fn().mockResolvedValue(undefined)
    const { deps } = makeSweepDeps([lease('c', 2)], { maxAttempts: 3, onEscalated })
    deps.store.recordEscalation = vi.fn().mockResolvedValue({ status: 'skipped' })
    await handleLeaseSweep(1000, deps)
    expect(onEscalated).not.toHaveBeenCalled()
  })

  it('onEscalated가 throw해도 sweep은 계속(best-effort·escalated 기록 보존)', async () => {
    const onEscalated = vi.fn().mockRejectedValue(new Error('brief fail'))
    const { deps } = makeSweepDeps([lease('c', 2)], { maxAttempts: 3, onEscalated })
    const out = await handleLeaseSweep(1000, deps)
    expect(out.escalated).toEqual([{ workflowId: 'wf-1', wpId: 'c', eventId: 'x1' }])
  })

  it('onEscalated 미주입이면 회귀 0', async () => {
    const { deps } = makeSweepDeps([lease('c', 2)], { maxAttempts: 3 })
    const out = await handleLeaseSweep(1000, deps)
    expect(out.escalated.length).toBe(1)
  })
})

describe('handleLeaseSweep projectId 조회 (C0/C1)', () => {
  it('escalate 시 graphStore로 projectId 조회→onEscalated 전달', async () => {
    const onEscalated = vi.fn().mockResolvedValue(undefined)
    const graphStore = { getGraph: vi.fn().mockResolvedValue({ userContext: { projectId: 'proj-1' } }) }
    const { deps } = makeSweepDeps([lease('c', 2)], { maxAttempts: 3, onEscalated, graphStore })
    await handleLeaseSweep(1000, deps)
    expect(onEscalated).toHaveBeenCalledWith(expect.objectContaining({ wpId: 'c', projectId: 'proj-1' }))
  })
  it('graphStore.getGraph throw → projectId null·escalation 비차단(N3)', async () => {
    const onEscalated = vi.fn().mockResolvedValue(undefined)
    const graphStore = { getGraph: vi.fn().mockRejectedValue(new Error('boom')) }
    const { deps } = makeSweepDeps([lease('c', 2)], { maxAttempts: 3, onEscalated, graphStore })
    const out = await handleLeaseSweep(1000, deps)
    expect(onEscalated).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }))
    expect(out.escalated.length).toBe(1)
  })
  it('graphStore 미주입 → projectId null', async () => {
    const onEscalated = vi.fn().mockResolvedValue(undefined)
    const { deps } = makeSweepDeps([lease('c', 2)], { maxAttempts: 3, onEscalated })
    await handleLeaseSweep(1000, deps)
    expect(onEscalated).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }))
  })
})
