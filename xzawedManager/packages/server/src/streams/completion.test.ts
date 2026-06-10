import { describe, it, expect, vi } from 'vitest'
import { handleCompletion, type CompletionDeps } from './completion.js'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { StoredGraph, WpStateRecord } from '../db/task-graph.repo.js'
import type { LeaseRecord } from '../db/lease.repo.js'

const wp = (id: string, deps: string[] = []): WorkPackage => ({
  id, storyId: 'story-1', owningRole: 'developer', oracleRef: 'oracle-1',
  acceptanceCriteria: [], dependencies: deps, attributionCounters: {}, status: 'draft',
})
const stored = (wps: WorkPackage[]): StoredGraph => ({ workflowId: 'wf-1', workPackages: wps, eventId: null, version: 1, userContext: null })
const stateRec = (wpId: string, toState: string): WpStateRecord => ({
  seq: 1, workflowId: 'wf-1', wpId, fromState: null, toState, eventId: null, reason: null, occurredAt: 0,
})
const activeLease = (over: Partial<LeaseRecord> = {}): LeaseRecord => ({
  workflowId: 'wf-1', wpId: 'a', attempt: 0, owner: null, status: 'active', expiresAt: 0, stepN: 0, eventId: null, ...over,
})

/** completion deps: mock leaseStore + dispatch deps(완료 후 handleDispatch가 실제 실행). */
function makeDeps(opts: {
  lease: LeaseRecord | null
  completeResult?: { status: 'completed'; eventId: string; seq: number } | { status: 'skipped' }
  redispatchGraph?: StoredGraph
  redispatchStates?: Map<string, WpStateRecord>
}) {
  const leaseStore = {
    getLease: vi.fn().mockResolvedValue(opts.lease),
    recordCompletion: vi.fn().mockResolvedValue(opts.completeResult ?? { status: 'completed', eventId: 'c1', seq: 1 }),
  }
  let n = 0
  const repo = {
    getGraph: vi.fn().mockResolvedValue(opts.redispatchGraph ?? null),
    latestStates: vi.fn().mockResolvedValue(opts.redispatchStates ?? new Map()),
  }
  const store = { recordDispatch: vi.fn().mockImplementation(() => Promise.resolve({ status: 'recorded', eventId: `d${n++}`, seq: n })) }
  const deps = { leaseStore, dispatch: { repo, store } } as unknown as CompletionDeps
  return { deps, leaseStore, repo, store }
}

describe('handleCompletion', () => {
  it('getLease가 null이면 skip·recordCompletion·재디스패치 미호출', async () => {
    const { deps, leaseStore, repo } = makeDeps({ lease: null })
    const out = await handleCompletion('wf-1', 'a', deps)
    expect(out).toEqual({ status: 'skipped', dispatched: [] })
    expect(leaseStore.recordCompletion).not.toHaveBeenCalled()
    expect(repo.getGraph).not.toHaveBeenCalled()
  })

  it('lease가 active가 아니면 skip', async () => {
    const { deps, leaseStore } = makeDeps({ lease: activeLease({ status: 'escalated' }) })
    const out = await handleCompletion('wf-1', 'a', deps)
    expect(out.status).toBe('skipped')
    expect(leaseStore.recordCompletion).not.toHaveBeenCalled()
  })

  it('active lease면 recordCompletion(attempt/stepN 전달) 후 handleDispatch로 후행을 재디스패치한다', async () => {
    // a 완료 → b(dep a)가 unblock. 재디스패치 시 latestStates에 a=DONE 반영.
    const { deps, leaseStore, store } = makeDeps({
      lease: activeLease({ attempt: 1, stepN: 2 }),
      redispatchGraph: stored([wp('a'), wp('b', ['a'])]),
      redispatchStates: new Map([['a', stateRec('a', 'DONE')]]),
    })
    const out = await handleCompletion('wf-1', 'a', deps)
    expect(leaseStore.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-1', wpId: 'a', attempt: 1, stepN: 2 }))
    expect(out.status).toBe('completed')
    expect(out.eventId).toBe('c1')
    expect(out.dispatched.map((x) => x.wpId)).toEqual(['b']) // a 완료로 b unblock·디스패치
    expect(store.recordDispatch).toHaveBeenCalledTimes(1)
  })

  it('recordCompletion이 skipped면 재디스패치하지 않는다', async () => {
    const { deps, repo } = makeDeps({ lease: activeLease(), completeResult: { status: 'skipped' } })
    const out = await handleCompletion('wf-1', 'a', deps)
    expect(out).toEqual({ status: 'skipped', dispatched: [] })
    expect(repo.getGraph).not.toHaveBeenCalled() // handleDispatch 미호출
  })
})
