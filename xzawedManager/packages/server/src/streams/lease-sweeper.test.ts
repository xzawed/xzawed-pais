import { describe, it, expect, vi, afterEach } from 'vitest'
import { LeaseSweeper } from './lease-sweeper.js'
import type { LeaseStore } from '../db/lease.repo.js'

function makeStore(expired: unknown[] = []) {
  return {
    expiredActiveLeases: vi.fn().mockResolvedValue(expired),
    recordReclaim: vi.fn().mockResolvedValue({ status: 'reclaimed', eventId: 'r', seq: 1 }),
    recordEscalation: vi.fn().mockResolvedValue({ status: 'escalated', eventId: 'e', seq: 1 }),
  }
}
const deps = (store: ReturnType<typeof makeStore>) =>
  ({ store: store as unknown as LeaseStore, maxAttempts: 3, visibilityMs: 5000 })

afterEach(() => vi.useRealTimers())

describe('LeaseSweeper', () => {
  it('pollOnce가 handleLeaseSweep(now)을 호출한다(store.expiredActiveLeases에 now 전달)', async () => {
    const store = makeStore()
    await new LeaseSweeper(deps(store), 30000, () => 4242).pollOnce()
    expect(store.expiredActiveLeases).toHaveBeenCalledWith(4242)
  })

  it('재진입 가드: 진행 중이면 두 번째 pollOnce는 즉시 반환(중복 sweep 0)', async () => {
    const store = makeStore()
    let release: () => void = () => {}
    store.expiredActiveLeases.mockImplementation(() => new Promise((r) => { release = () => r([]) }))
    const sw = new LeaseSweeper(deps(store))
    const p1 = sw.pollOnce()
    const p2 = sw.pollOnce() // 진행 중 → 즉시 반환
    release()
    await Promise.all([p1, p2])
    expect(store.expiredActiveLeases).toHaveBeenCalledTimes(1)
  })

  it('handleLeaseSweep 실패해도 throw하지 않는다(never-throw)', async () => {
    const store = makeStore()
    store.expiredActiveLeases.mockRejectedValue(new Error('boom'))
    await expect(new LeaseSweeper(deps(store)).pollOnce()).resolves.toBeUndefined()
  })

  it('start가 sweepMs 주기로 폴링하고 stop이 멈춘다', () => {
    vi.useFakeTimers()
    const store = makeStore()
    const sw = new LeaseSweeper(deps(store), 1000)
    sw.start()
    vi.advanceTimersByTime(1000)
    expect(store.expiredActiveLeases).toHaveBeenCalledTimes(1)
    sw.stop()
    vi.advanceTimersByTime(3000)
    expect(store.expiredActiveLeases).toHaveBeenCalledTimes(1) // stop 후 추가 호출 없음
  })

  it('graphStore를 handleLeaseSweep으로 전달해 onEscalated에 projectId 부여', async () => {
    const onEscalated = vi.fn().mockResolvedValue(undefined)
    const graphStore = { getGraph: vi.fn().mockResolvedValue({ userContext: { projectId: 'proj-1' } }) }
    const expired = [{ workflowId: 'wf-1', wpId: 'c', attempt: 2, owner: null, status: 'active', expiresAt: 0, stepN: 0, eventId: null }]
    const store = {
      expiredActiveLeases: vi.fn().mockResolvedValue(expired),
      recordReclaim: vi.fn(),
      recordEscalation: vi.fn().mockResolvedValue({ status: 'escalated', eventId: 'x1', seq: 1 }),
    }
    const sweeper = new LeaseSweeper({ store: store as never, maxAttempts: 1, visibilityMs: 1000, onEscalated, graphStore }, 30_000)
    await sweeper.pollOnce()
    expect(onEscalated).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1' }))
  })
})
