import { describe, it, expect, vi } from 'vitest'
import { buildTaskGraph, WorkPackageSchema, type WorkPackage } from '@xzawed/agent-streams'
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
  workflowId: 'wf-1', workPackages: wps, eventId, version: 1, userContext: null,
})
const stateRec = (wpId: string, toState: string): WpStateRecord => ({
  seq: 1, workflowId: 'wf-1', wpId, fromState: null, toState, eventId: null, reason: null, occurredAt: 0,
})

function makeDeps(graph: StoredGraph | null, states: Map<string, WpStateRecord> = new Map()) {
  let n = 0
  const recordDispatch = vi.fn().mockImplementation(() => Promise.resolve({ status: 'recorded', eventId: `e${n++}`, seq: n }))
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
      attempt: 0, visibilityMs: expect.any(Number),
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

  it('recordDispatch가 deduped를 반환하면 dispatched에서 제외하고 skipped로 센다(DB 레벨 dedup)', async () => {
    let n = 0
    const recordDispatch = vi.fn().mockImplementation(() =>
      Promise.resolve(n++ === 0 ? { status: 'deduped' } : { status: 'recorded', eventId: 'e1', seq: 1 }))
    const repo = { getGraph: vi.fn().mockResolvedValue(stored([wp('a'), wp('b')])), latestStates: vi.fn().mockResolvedValue(new Map()) }
    const deps = { repo, store: { recordDispatch } } as unknown as DispatchDeps
    const out = await handleDispatch('wf-1', deps)
    expect(out.dispatched).toEqual([{ wpId: 'b', stepN: 1, eventId: 'e1' }])
    expect(out.skipped).toBe(1) // 'a'는 deduped
  })

  it('deps.visibilityMs를 recordDispatch에 전달한다', async () => {
    const { deps, recordDispatch } = makeDeps(stored([wp('a')]))
    await handleDispatch('wf-1', { ...deps, visibilityMs: 9999 })
    expect(recordDispatch).toHaveBeenCalledWith(expect.objectContaining({ visibilityMs: 9999 }))
  })

  it('latestStates에 선행이 DONE이면 후행이 ready로 디스패치된다(P1d-6 완료 unblock)', async () => {
    const states = new Map([['a', stateRec('a', 'DONE')]])
    const { deps, recordDispatch } = makeDeps(stored([wp('a'), wp('b', ['a'])]), states)
    const out = await handleDispatch('wf-1', deps)
    // a는 DONE(readyNodes 제외)·b는 dep a가 done이라 ready → b만 디스패치
    expect(out.dispatched.map((x) => x.wpId)).toEqual(['b'])
    expect(recordDispatch).toHaveBeenCalledTimes(1)
  })

  it('latestStates에 ESCALATED인 WP는 alreadyDispatched로 제외한다', async () => {
    const states = new Map([['a', stateRec('a', 'ESCALATED')]])
    const { deps, recordDispatch } = makeDeps(stored([wp('a'), wp('b')]), states)
    const out = await handleDispatch('wf-1', deps)
    expect(out.dispatched.map((x) => x.wpId)).toEqual(['b']) // a는 escalated 재디스패치 금지
    expect(recordDispatch).toHaveBeenCalledTimes(1)
  })
})

// ── P4-1 트리거 신호 발행 ────────────────────────────────────────
// 기존 makeDeps 패턴을 복제·추출: ready WP 'a' 1개·latestStates 빈·recordDispatch는 주입 결과 반환.
function makeDispatchDepsOneReady(over: { recordResult?: { status: string; eventId?: string; seq?: number } } = {}) {
  const recordResult = over.recordResult ?? { status: 'recorded', eventId: 'e0', seq: 1 }
  const recordDispatch = vi.fn().mockResolvedValue(recordResult)
  const repo = {
    getGraph: vi.fn().mockResolvedValue(stored([wp('a')])),
    latestStates: vi.fn().mockResolvedValue(new Map()),
  }
  return { repo, store: { recordDispatch } } as unknown as DispatchDeps
}

describe('handleDispatch 트리거 신호 (P4-1)', () => {
  it('publish 주입 시 recordDispatch(recorded) 후 wp.dispatch_signal 발행(attempt=0)', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const deps = makeDispatchDepsOneReady()
    await handleDispatch('wf1', { ...deps, publish })
    const call = publish.mock.calls.find((c) => c[0] === 'manager:dispatched:main')
    expect(call).toBeTruthy()
    expect(call![1]).toMatchObject({ type: 'wp.dispatch_signal', payload: { wpId: 'a', attempt: 0 } })
  })
  it('publish 미주입이면 신호 없음(회귀 0)', async () => {
    const deps = makeDispatchDepsOneReady()
    const out = await handleDispatch('wf1', deps)
    expect(out.dispatched.length).toBeGreaterThan(0) // 디스패치는 정상
  })
  it('deduped면 신호 없음', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const deps = makeDispatchDepsOneReady({ recordResult: { status: 'deduped' } })
    await handleDispatch('wf1', { ...deps, publish })
    expect(publish.mock.calls.find((c) => c[0] === 'manager:dispatched:main')).toBeUndefined()
  })
})

describe('handleDispatch + oracleStore 주입 (P3-1)', () => {
  const wps = [
    WorkPackageSchema.parse({ id: 'a', storyId: 's1', owningRole: 'dev', oracleRef: null, acceptanceCriteria: ['ac1'] }),
    WorkPackageSchema.parse({ id: 'b', storyId: 's2', owningRole: 'dev', oracleRef: null, acceptanceCriteria: ['ac1'] }),
  ]
  const repo = { getGraph: vi.fn().mockResolvedValue({ workPackages: wps, eventId: null }), latestStates: vi.fn().mockResolvedValue(new Map()) }
  const store = { recordDispatch: vi.fn().mockImplementation((i: { wpId: string }) => Promise.resolve({ status: 'recorded', eventId: `e-${i.wpId}`, seq: 1 })) }

  it('oracleStore 주입 시 satisfied WP만 디스패치(s1만 승인)', async () => {
    const oracleStore = { approvedByWorkflow: vi.fn().mockResolvedValue([{ storyId: 's1', coveredCriteria: new Set(['ac1']) }]) }
    const out = await handleDispatch('wf1', { repo: repo as never, store: store as never, oracleStore: oracleStore as never })
    expect(out.dispatched.map((d) => d.wpId)).toEqual(['a']) // s2는 오라클 없어 미충족
  })

  it('oracleStore 없으면 기본 술어(oracleRef!=null)로 0건(flag off 회귀)', async () => {
    const out = await handleDispatch('wf1', { repo: repo as never, store: store as never })
    expect(out.dispatched).toEqual([])
  })
})

describe('handleDispatch P5-3b SAFE 게이트', () => {
  it('P5-3b: getMode가 SAFE면 held 반환·recordDispatch 미호출·onHeld 호출(held WP 전이 0)', async () => {
    const { deps, recordDispatch } = makeDeps(stored([wp('a'), wp('b')]))
    const onHeld = vi.fn()
    const out = await handleDispatch('wf-1', { ...deps, getMode: () => 'SAFE', onHeld })
    expect(out).toEqual({ status: 'held', dispatched: [], skipped: 0 })
    expect(recordDispatch).not.toHaveBeenCalled()
    expect(onHeld).toHaveBeenCalledWith('wf-1')
  })

  it('P5-3b: getMode가 DEGRADED/NORMAL이면 정상 디스패치(SAFE만 보류)', async () => {
    const { deps, recordDispatch } = makeDeps(stored([wp('a')]))
    const out = await handleDispatch('wf-1', { ...deps, getMode: () => 'DEGRADED' })
    expect(out.status).toBe('dispatched')
    expect(recordDispatch).toHaveBeenCalledTimes(1)
  })

  it('P5-3b: getMode 미주입이면 기존 동작(회귀 0)', async () => {
    const { deps, recordDispatch } = makeDeps(stored([wp('a')]))
    const out = await handleDispatch('wf-1', deps)
    expect(out.status).toBe('dispatched')
    expect(recordDispatch).toHaveBeenCalledTimes(1)
  })

  it('P5-3b: SAFE여도 graph 없으면 noop 유지(held는 graph 있을 때만)', async () => {
    const { deps, recordDispatch } = makeDeps(null)
    const onHeld = vi.fn()
    const out = await handleDispatch('wf-1', { ...deps, getMode: () => 'SAFE', onHeld })
    expect(out).toEqual({ status: 'noop', dispatched: [], skipped: 0 })
    expect(onHeld).not.toHaveBeenCalled()
    expect(recordDispatch).not.toHaveBeenCalled()
  })
})
