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
const stateRec = (wpId: string, toState: string, seq = 1): WpStateRecord => ({
  seq, workflowId: 'wf-1', wpId, fromState: null, toState, eventId: null, reason: null, occurredAt: 0,
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
  releaseGateEnabled?: boolean
  releaseStore?: CompletionDeps['releaseStore']
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
  const deps = {
    leaseStore,
    dispatch: { repo, store },
    ...(opts.releaseGateEnabled !== undefined && { releaseGateEnabled: opts.releaseGateEnabled }),
    ...(opts.releaseStore !== undefined && { releaseStore: opts.releaseStore }),
  } as unknown as CompletionDeps
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

  // P5-1b: all-WP-done 시 릴리스 게이트 평가·영속
  it('evaluates release gate when all WPs DONE (P5-1b)', async () => {
    const gates: Array<{ version: string; status: string }> = []
    const releaseStore: CompletionDeps['releaseStore'] = {
      evidenceForWorkflow: async () => new Map([['wp-a', [{ channel: 'tc', outcome: 'passed' }]]]),
      recordGate: async (_wf: string, version: string, result: { status: string }) => {
        gates.push({ version, status: result.status })
        return { eventId: 'e1' }
      },
    }
    // 단일 WP 'wp-a'가 DONE → allWpDone=true → 게이트 평가
    const graph = stored([wp('wp-a')])
    const states = new Map([['wp-a', stateRec('wp-a', 'DONE', 5)]])
    const { deps } = makeDeps({
      lease: activeLease({ wpId: 'wp-a' }),
      redispatchGraph: graph,
      redispatchStates: states,
      releaseGateEnabled: true,
      releaseStore,
    })
    const out = await handleCompletion('wf-c', 'wp-a', deps)
    expect(out.status).toBe('completed')
    expect(gates).toHaveLength(1)
    expect(gates[0]!.status).toBe('passed')
    expect(out.gate).toBe('passed')
  })

  it('does NOT evaluate gate when a WP still not DONE', async () => {
    const gates: Array<{ version: string; status: string }> = []
    const releaseStore: CompletionDeps['releaseStore'] = {
      evidenceForWorkflow: async () => new Map(),
      recordGate: async (_wf, version, result) => { gates.push({ version, status: result.status }); return { eventId: 'e2' } },
    }
    // wp-a DONE, wp-b ESCALATED → allWpDone=false → recordGate 미호출
    const graph = stored([wp('wp-a'), wp('wp-b')])
    const states = new Map([
      ['wp-a', stateRec('wp-a', 'DONE')],
      ['wp-b', stateRec('wp-b', 'ESCALATED')],
    ])
    const { deps } = makeDeps({
      lease: activeLease({ wpId: 'wp-a' }),
      redispatchGraph: graph,
      redispatchStates: states,
      releaseGateEnabled: true,
      releaseStore,
    })
    const out = await handleCompletion('wf-c', 'wp-a', deps)
    expect(out.status).toBe('completed')
    expect(gates).toHaveLength(0)
    expect(out.gate).toBeUndefined()
  })

  it('no gate eval when releaseGate disabled (regression 0)', async () => {
    const gates: Array<{ version: string; status: string }> = []
    const releaseStore: CompletionDeps['releaseStore'] = {
      evidenceForWorkflow: async () => new Map([['wp-a', [{ channel: 'tc', outcome: 'passed' }]]]),
      recordGate: async (_wf, version, result) => { gates.push({ version, status: result.status }); return { eventId: 'e3' } },
    }
    // releaseGateEnabled 미주입 → 게이트 평가 없음(회귀 0)
    const graph = stored([wp('wp-a')])
    const states = new Map([['wp-a', stateRec('wp-a', 'DONE', 3)]])
    const { deps } = makeDeps({
      lease: activeLease({ wpId: 'wp-a' }),
      redispatchGraph: graph,
      redispatchStates: states,
      // releaseGateEnabled: undefined — 의도적 미주입
      releaseStore,
    })
    const out = await handleCompletion('wf-c', 'wp-a', deps)
    expect(out.status).toBe('completed')
    expect(gates).toHaveLength(0)
    expect(out.gate).toBeUndefined()
  })
})
