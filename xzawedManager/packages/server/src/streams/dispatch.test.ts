import { describe, it, expect, vi } from 'vitest'
import { buildTaskGraph, type WorkPackage } from '@xzawed/agent-streams'
import { planDispatch, handleDispatch, type DispatchDeps } from './dispatch.js'
import type { StoredGraph, WpStateRecord } from '../db/task-graph.repo.js'

const wp = (id: string, deps: string[] = [], over: Partial<WorkPackage> = {}): WorkPackage => ({
  id, storyId: 'story-1', owningRole: 'developer', oracleRef: 'oracle-1',
  acceptanceCriteria: [], dependencies: deps, attributionCounters: {}, status: 'draft', ...over,
})
const G = (wps: WorkPackage[]) => buildTaskGraph(wps)

describe('planDispatch (순수)', () => {
  it('독립 ready 노드에 topo 인덱스 step-N과 DRAFTED fromState를 부여한다', () => {
    const plan = planDispatch(G([wp('a'), wp('b'), wp('c')]))
    expect(plan).toEqual([
      { wpId: 'a', stepN: 0, fromState: 'DRAFTED' },
      { wpId: 'b', stepN: 1, fromState: 'DRAFTED' },
      { wpId: 'c', stepN: 2, fromState: 'DRAFTED' },
    ])
  })

  it('선행 의존이 미완이면 후행은 ready가 아니다(루트만 디스패치)', () => {
    const plan = planDispatch(G([wp('a'), wp('b', ['a']), wp('c', ['b'])]))
    expect(plan).toEqual([{ wpId: 'a', stepN: 0, fromState: 'DRAFTED' }])
  })

  it('alreadyDispatched는 제외하되 step-N은 전체 order 기준을 유지한다', () => {
    const plan = planDispatch(G([wp('a'), wp('b')]), { alreadyDispatched: new Set(['a']) })
    expect(plan).toEqual([{ wpId: 'b', stepN: 1, fromState: 'DRAFTED' }])
  })

  it('ready가 없으면(이미 done) 빈 배열', () => {
    expect(planDispatch(G([wp('a', [], { status: 'done' })]))).toEqual([])
  })

  it('oracle 미충족이면 ready가 아니다(기본 술어: oracleRef != null)', () => {
    expect(planDispatch(G([wp('a', [], { oracleRef: null })]))).toEqual([])
  })

  it('readiness.oracleSatisfied 주입으로 oracle 게이트를 우회할 수 있다', () => {
    const plan = planDispatch(G([wp('a', [], { oracleRef: null })]), {
      readiness: { oracleSatisfied: () => true },
    })
    expect(plan).toEqual([{ wpId: 'a', stepN: 0, fromState: 'DRAFTED' }])
  })

  it('readiness.isDone 주입으로 외부 done-set을 반영해 후행을 unblock한다', () => {
    const plan = planDispatch(G([wp('a'), wp('b', ['a'])]), {
      readiness: { isDone: (w) => w.id === 'a' },
    })
    // a는 done이라 제외, b는 dep a가 done이므로 ready
    expect(plan).toEqual([{ wpId: 'b', stepN: 1, fromState: 'DRAFTED' }])
  })

  it('cyclic 노드는 제외한다(readyNodes/topoSort 경유)', () => {
    const plan = planDispatch(G([wp('a', ['b']), wp('b', ['a']), wp('c')]))
    expect(plan).toEqual([{ wpId: 'c', stepN: 0, fromState: 'DRAFTED' }])
  })
})

// ── handleDispatch ─────────────────────────────────────────────
const stored = (wps: WorkPackage[], eventId: string | null = null): StoredGraph => ({
  workflowId: 'wf-1', workPackages: wps, eventId, version: 1,
})
const stateRec = (wpId: string, toState: string): WpStateRecord => ({
  seq: 1, workflowId: 'wf-1', wpId, fromState: null, toState, eventId: null, reason: null, occurredAt: 0,
})

function makeDeps(graph: StoredGraph | null, states: Map<string, WpStateRecord> = new Map()) {
  let n = 0
  const recordDispatch = vi.fn().mockImplementation(() => Promise.resolve({ eventId: `e${n++}`, seq: n }))
  const repo = {
    getGraph: vi.fn().mockResolvedValue(graph),
    latestStates: vi.fn().mockResolvedValue(states),
  }
  const store = { recordDispatch }
  return { deps: { repo, store } as unknown as DispatchDeps, recordDispatch, repo }
}

describe('handleDispatch', () => {
  it('getGraph가 null이면 noop이고 store를 호출하지 않는다', async () => {
    const { deps, recordDispatch } = makeDeps(null)
    const out = await handleDispatch('wf-1', deps)
    expect(out).toEqual({ status: 'noop', dispatched: [], skipped: 0 })
    expect(recordDispatch).not.toHaveBeenCalled()
  })

  it('ready WP마다 recordDispatch를 호출하고 dispatched에 eventId를 매핑한다', async () => {
    const { deps, recordDispatch } = makeDeps(stored([wp('a'), wp('b')]))
    const out = await handleDispatch('wf-1', deps)
    expect(recordDispatch).toHaveBeenCalledTimes(2)
    expect(recordDispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workflowId: 'wf-1', wpId: 'a', stepN: 0, fromState: 'DRAFTED', causationId: null,
    }))
    expect(out.status).toBe('dispatched')
    expect(out.skipped).toBe(0)
    expect(out.dispatched).toEqual([
      { wpId: 'a', stepN: 0, eventId: 'e0' },
      { wpId: 'b', stepN: 1, eventId: 'e1' },
    ])
  })

  it('이미 DISPATCHED인 ready WP는 제외하고 skipped로 센다', async () => {
    const states = new Map([['a', stateRec('a', 'DISPATCHED')]])
    const { deps, recordDispatch } = makeDeps(stored([wp('a'), wp('b')]), states)
    const out = await handleDispatch('wf-1', deps)
    expect(recordDispatch).toHaveBeenCalledTimes(1)
    expect(recordDispatch).toHaveBeenCalledWith(expect.objectContaining({ wpId: 'b' }))
    expect(out.skipped).toBe(1)
    expect(out.dispatched).toEqual([{ wpId: 'b', stepN: 1, eventId: 'e0' }])
  })

  it('그래프 출처 eventId를 causationId로 전달한다', async () => {
    const { deps, recordDispatch } = makeDeps(stored([wp('a')], 'src-evt'))
    await handleDispatch('wf-1', deps)
    expect(recordDispatch).toHaveBeenCalledWith(expect.objectContaining({ causationId: 'src-evt' }))
  })

  it('deps.readiness를 planDispatch로 전달한다(oracle 미정 WP도 디스패치)', async () => {
    const { deps, recordDispatch } = makeDeps(stored([wp('a', [], { oracleRef: null })]))
    const out = await handleDispatch('wf-1', { ...deps, readiness: { oracleSatisfied: () => true } })
    expect(recordDispatch).toHaveBeenCalledTimes(1)
    expect(out.dispatched).toHaveLength(1)
  })

  it('ready가 모두 이미 디스패치면 dispatched는 비고 status는 dispatched다', async () => {
    const states = new Map([['a', stateRec('a', 'DISPATCHED')]])
    const { deps, recordDispatch } = makeDeps(stored([wp('a')]), states)
    const out = await handleDispatch('wf-1', deps)
    expect(recordDispatch).not.toHaveBeenCalled()
    expect(out).toEqual({ status: 'dispatched', dispatched: [], skipped: 1 })
  })
})
