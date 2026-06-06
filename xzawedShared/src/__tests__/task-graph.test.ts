import { describe, it, expect } from 'vitest'
import type { WorkPackage } from '../types/work-package.js'
import {
  buildTaskGraph,
  detectCycle,
  topoSort,
  isReady,
  readyNodes,
} from '../task-graph/index.js'

/** 테스트 WP 생성 헬퍼 — 기본값 채우고 핵심 필드만 override. */
function wp(id: string, over: Partial<WorkPackage> = {}): WorkPackage {
  return {
    id,
    storyId: 'story-1',
    owningRole: 'developer',
    oracleRef: 'oracle-1',
    acceptanceCriteria: [],
    dependencies: [],
    attributionCounters: {},
    status: 'draft',
    ...over,
  }
}

describe('buildTaskGraph', () => {
  it('노드·의존·역의존 인덱스를 정확히 만든다', () => {
    const g = buildTaskGraph([wp('a'), wp('b', { dependencies: ['a'] })])
    expect([...g.nodes.keys()]).toEqual(['a', 'b'])
    expect([...(g.dependencies.get('b') ?? [])]).toEqual(['a'])
    expect([...(g.dependents.get('a') ?? [])]).toEqual(['b'])
    expect([...(g.dependencies.get('a') ?? [])]).toEqual([])
  })

  it('빈 입력이면 빈 그래프를 만든다', () => {
    const g = buildTaskGraph([])
    expect(g.nodes.size).toBe(0)
  })

  it('삽입 순서를 nodes에 보존한다', () => {
    const g = buildTaskGraph([wp('z'), wp('a'), wp('m')])
    expect([...g.nodes.keys()]).toEqual(['z', 'a', 'm'])
  })

  it('중복 id는 throw한다', () => {
    expect(() => buildTaskGraph([wp('a'), wp('a')])).toThrow('duplicate work package id: a')
  })

  it('존재하지 않는 의존(dangling) 참조는 throw한다', () => {
    expect(() => buildTaskGraph([wp('a', { dependencies: ['ghost'] })]))
      .toThrow('unknown dependency "ghost" referenced by "a"')
  })
})

describe('detectCycle', () => {
  it('비순환 그래프는 빈 배열을 반환한다', () => {
    const g = buildTaskGraph([wp('a'), wp('b', { dependencies: ['a'] }), wp('c', { dependencies: ['b'] })])
    expect(detectCycle(g)).toEqual([])
  })

  it('단순 사이클(a→b→a)을 검출한다', () => {
    const g = buildTaskGraph([wp('a', { dependencies: ['b'] }), wp('b', { dependencies: ['a'] })])
    const cycles = detectCycle(g)
    expect(cycles.length).toBeGreaterThan(0)
    expect(cycles[0]).toEqual(expect.arrayContaining(['a', 'b']))
  })

  it('자기참조(a→a)를 사이클로 검출한다', () => {
    const g = buildTaskGraph([wp('a', { dependencies: ['a'] })])
    expect(detectCycle(g).length).toBeGreaterThan(0)
  })
})

describe('topoSort', () => {
  it('선형 의존을 위상순서로 정렬한다', () => {
    const g = buildTaskGraph([wp('c', { dependencies: ['b'] }), wp('b', { dependencies: ['a'] }), wp('a')])
    expect(topoSort(g)).toEqual({ order: ['a', 'b', 'c'], cyclic: [] })
  })

  it('분기에서 결정론 타이브레이크(id 사전순)를 따른다', () => {
    // a 다음 b, c 모두 ready — id 사전순 b,c
    const g = buildTaskGraph([wp('a'), wp('c', { dependencies: ['a'] }), wp('b', { dependencies: ['a'] })])
    expect(topoSort(g).order).toEqual(['a', 'b', 'c'])
  })

  it('동순위는 id 사전순으로 정렬한다', () => {
    // 루트가 여럿(의존 없음): 삽입순 z,a,m 이지만 동순위라 사전순 a,m,z
    const g = buildTaskGraph([wp('z'), wp('a'), wp('m')])
    expect(topoSort(g).order).toEqual(['a', 'm', 'z'])
  })

  it('같은 입력은 항상 같은 order를 낸다(결정론)', () => {
    const make = () => buildTaskGraph([wp('a'), wp('b', { dependencies: ['a'] }), wp('c', { dependencies: ['a'] })])
    expect(topoSort(make()).order).toEqual(topoSort(make()).order)
  })

  it('사이클 노드는 order에서 빠지고 cyclic에 모인다', () => {
    const g = buildTaskGraph([wp('a'), wp('b', { dependencies: ['c'] }), wp('c', { dependencies: ['b'] })])
    const { order, cyclic } = topoSort(g)
    expect(order).toEqual(['a'])
    expect(cyclic.sort()).toEqual(['b', 'c'])
  })
})

describe('isReady / readyNodes', () => {
  it('의존이 미완이면 ready가 아니다', () => {
    const g = buildTaskGraph([wp('a'), wp('b', { dependencies: ['a'] })])
    expect(isReady(g.nodes.get('b')!, g)).toBe(false)
  })

  it('모든 의존이 done이면 ready다', () => {
    const g = buildTaskGraph([wp('a', { status: 'done' }), wp('b', { dependencies: ['a'] })])
    expect(isReady(g.nodes.get('b')!, g)).toBe(true)
  })

  it('의존 없고 오라클 있으면 ready다', () => {
    const g = buildTaskGraph([wp('a')])
    expect(isReady(g.nodes.get('a')!, g)).toBe(true)
  })

  it('오라클(oracleRef null) 없으면 ready가 아니다(DoR)', () => {
    const g = buildTaskGraph([wp('a', { oracleRef: null })])
    expect(isReady(g.nodes.get('a')!, g)).toBe(false)
  })

  it('oracleSatisfied 주입으로 oracleRef 기본 가드를 대체한다', () => {
    const g = buildTaskGraph([wp('a', { oracleRef: null })])
    expect(isReady(g.nodes.get('a')!, g, { oracleSatisfied: () => true })).toBe(true)
  })

  it('isDone 주입(외부 done-set)으로 status 대신 판정한다', () => {
    const g = buildTaskGraph([wp('a'), wp('b', { dependencies: ['a'] })])
    const done = new Set(['a'])
    expect(isReady(g.nodes.get('b')!, g, { isDone: (n) => done.has(n.id) })).toBe(true)
  })

  it('이미 done이면 ready가 아니다', () => {
    const g = buildTaskGraph([wp('a', { status: 'done' })])
    expect(isReady(g.nodes.get('a')!, g)).toBe(false)
  })

  it('readyNodes는 topo 순서로 ready만, cyclic은 제외한다', () => {
    const g = buildTaskGraph([
      wp('a', { status: 'done' }),
      wp('b', { dependencies: ['a'] }),
      wp('c', { dependencies: ['a'] }),
      wp('x', { dependencies: ['y'] }),
      wp('y', { dependencies: ['x'] }),
    ])
    expect(readyNodes(g)).toEqual(['b', 'c'])
  })

  it('readyNodes는 같은 입력에 결정론 순서를 낸다', () => {
    const g = buildTaskGraph([wp('z'), wp('a'), wp('m')])
    expect(readyNodes(g)).toEqual(['a', 'm', 'z'])
  })
})
