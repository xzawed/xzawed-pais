import { describe, it, expect, vi } from 'vitest'
import { handleDecompositionEmitted, type DecompositionEmittedMessage } from './decomposition-consumer.js'
import type { WorkPackage, EventEnvelope, WpStatus } from '@xzawed/agent-streams'
import type { TaskGraphRepo, WpStateRecord } from '../db/task-graph.repo.js'

/**
 * **재진입 병합 배선**(S6.2 / 결함 F1). 재분해가 진행 중 WP 를 통째로 덮어쓰던 것을 막는다.
 *
 * **여기서 기본 술어를 쓰면 위음성이다.** `mergeKeepInflight` 의 기본 `isInflight` 는
 * `wp.status` 를 읽는데, `graph_dag` 의 status 는 프로덕션에서 **영원히 `DRAFTED`** 다
 * (`decompose/map.ts:44` 가 유일한 writer 이고 이후 아무도 바꾸지 않는다).
 * 실제 진행 상태는 `wp_state_log` 에만 있으므로 술어는 `latestStates` 에서 와야 한다 —
 * `dispatch.ts` 가 `isDone` 을 `doneSet` 으로 갈아끼우는 것과 같은 구조다.
 */

const wp = (id: string, deps: string[] = [], over: Partial<WorkPackage> = {}): WorkPackage => ({
  id, storyId: 's1', owningRole: 'developer', oracleRef: null,
  acceptanceCriteria: ['old'], dependencies: deps, attributionCounters: {}, status: 'DRAFTED', ...over,
})

const env = (): EventEnvelope => ({
  eventId: 'evt-2', correlationId: 'wf-1', causationId: null, idempotencyKey: 'wf-1:dec:1',
  workflowId: 'wf-1', stepId: 'dec', attemptId: 0, occurredAt: 2000,
})

const msg = (workPackages: WorkPackage[]): DecompositionEmittedMessage => ({
  envelope: env(), type: 'decomposition.emitted', payload: { workPackages, oracleDrafts: [] },
})

const stateRec = (wpId: string, toState: WpStatus): WpStateRecord => ({
  seq: 1, workflowId: 'wf-1', wpId, fromState: null, toState, eventId: null, reason: null, occurredAt: 1,
})

/** 기존 그래프 + wp_state_log 최신 상태를 갖는 repo. */
function repoWith(existing: WorkPackage[] | null, states: Array<[string, WpStatus]> = []) {
  const upsertGraph = vi.fn().mockResolvedValue({ version: 2 })
  const getGraph = vi.fn().mockResolvedValue(
    existing === null ? null : { workflowId: 'wf-1', workPackages: existing, eventId: null, version: 1, userContext: null },
  )
  const latestStates = vi.fn().mockResolvedValue(
    new Map(states.map(([id, s]) => [id, stateRec(id, s)])),
  )
  return { repo: { upsertGraph, getGraph, latestStates } as unknown as TaskGraphRepo, upsertGraph, getGraph, latestStates }
}

const persisted = (upsertGraph: ReturnType<typeof vi.fn>): WorkPackage[] =>
  upsertGraph.mock.calls[0]![0].workPackages

describe('재분해 — 진행 중 WP 보존(S6.2)', () => {
  it('DISPATCHED 인 WP 는 incoming 이 덮지 않는다', async () => {
    const { repo, upsertGraph } = repoWith(
      [wp('a', [], { acceptanceCriteria: ['진행중'] })],
      [['a', 'DISPATCHED']],
    )
    const publish = vi.fn()

    await handleDecompositionEmitted(msg([wp('a', [], { acceptanceCriteria: ['새 초안'] })]), { repo, publish })

    const out = persisted(upsertGraph)
    expect(out.find((w) => w.id === 'a')?.acceptanceCriteria).toEqual(['진행중'])
  })

  it.each(['DISPATCHED', 'BLOCKED', 'DONE', 'ESCALATED'] as const)(
    '%s 는 진행 중으로 보존한다', async (state) => {
      const { repo, upsertGraph } = repoWith([wp('a', [], { acceptanceCriteria: ['보존'] })], [['a', state]])
      await handleDecompositionEmitted(msg([wp('a', [], { acceptanceCriteria: ['교체'] })]), { repo, publish: vi.fn() })
      expect(persisted(upsertGraph).find((w) => w.id === 'a')?.acceptanceCriteria).toEqual(['보존'])
    })

  it.each(['DRAFTED', 'READY'] as const)('%s 는 미착수라 갱신한다', async (state) => {
    const { repo, upsertGraph } = repoWith([wp('a', [], { acceptanceCriteria: ['옛것'] })], [['a', state]])
    await handleDecompositionEmitted(msg([wp('a', [], { acceptanceCriteria: ['새것'] })]), { repo, publish: vi.fn() })
    expect(persisted(upsertGraph).find((w) => w.id === 'a')?.acceptanceCriteria).toEqual(['새것'])
  })

  it('전이 기록이 없는 WP 는 미착수로 본다(로그가 진실원천)', async () => {
    const { repo, upsertGraph } = repoWith([wp('a', [], { acceptanceCriteria: ['옛것'] })], [])
    await handleDecompositionEmitted(msg([wp('a', [], { acceptanceCriteria: ['새것'] })]), { repo, publish: vi.fn() })
    expect(persisted(upsertGraph).find((w) => w.id === 'a')?.acceptanceCriteria).toEqual(['새것'])
  })

  it('incoming 에서 사라진 진행 중 WP 도 보존한다', async () => {
    const { repo, upsertGraph } = repoWith([wp('a'), wp('b')], [['a', 'DISPATCHED']])
    await handleDecompositionEmitted(msg([wp('b')]), { repo, publish: vi.fn() })
    expect(persisted(upsertGraph).map((w) => w.id).sort()).toEqual(['a', 'b'])
  })

  it('보존 노드의 의존 폐포를 함께 유지한다(dangling 0)', async () => {
    // a(진행 중)가 dep 에 의존하는데 incoming 에서 dep 이 빠졌다 → dep 도 남아야 한다.
    const { repo, upsertGraph } = repoWith([wp('a', ['dep']), wp('dep')], [['a', 'DISPATCHED']])
    await handleDecompositionEmitted(msg([wp('c')]), { repo, publish: vi.fn() })
    expect(persisted(upsertGraph).map((w) => w.id).sort()).toEqual(['a', 'c', 'dep'])
  })

  it('기존 그래프가 없으면(최초 분해) incoming 을 그대로 쓴다', async () => {
    const { repo, upsertGraph, latestStates } = repoWith(null)
    await handleDecompositionEmitted(msg([wp('a'), wp('b', ['a'])]), { repo, publish: vi.fn() })
    expect(persisted(upsertGraph).map((w) => w.id)).toEqual(['a', 'b'])
    // 그래프가 없으면 전이 조회도 불필요하다(왕복 0).
    expect(latestStates).not.toHaveBeenCalled()
  })
})

describe('DB 오류는 삼키지 않는다', () => {
  /**
   * `structural` 은 **DAG 모양이 틀렸다**는 의미 범주다. 전송·저장 오류를 거기 담으면
   * 소비자가 메시지를 ack 하고 분해가 영영 사라진다 — 같은 파일의
   * "upsertGraph 실패는 structural 로 삼키지 않고 전파한다" 와 같은 이유로 읽기도 전파해야 한다.
   * 쓰기는 막되(fail-closed) 메시지는 재시도/DLQ 로 보존한다.
   */
  it('getGraph 실패는 inconsistent 로 바꾸지 않고 전파한다', async () => {
    const upsertGraph = vi.fn()
    const repo = {
      getGraph: vi.fn().mockRejectedValue(new Error('db down')),
      latestStates: vi.fn(),
      upsertGraph,
    } as unknown as TaskGraphRepo
    const publish = vi.fn()

    await expect(handleDecompositionEmitted(msg([wp('a')]), { repo, publish })).rejects.toThrow('db down')
    expect(upsertGraph, '읽기 실패 후에는 쓰면 안 된다').not.toHaveBeenCalled()
    expect(publish, 'inconsistent 로 위장하면 안 된다').not.toHaveBeenCalled()
  })

  it('latestStates 실패도 전파한다', async () => {
    const upsertGraph = vi.fn()
    const repo = {
      getGraph: vi.fn().mockResolvedValue({ workflowId: 'wf-1', workPackages: [wp('a')], eventId: null, version: 1, userContext: null }),
      latestStates: vi.fn().mockRejectedValue(new Error('db down')),
      upsertGraph,
    } as unknown as TaskGraphRepo

    await expect(handleDecompositionEmitted(msg([wp('a')]), { repo, publish: vi.fn() })).rejects.toThrow('db down')
    expect(upsertGraph).not.toHaveBeenCalled()
  })
})

describe('병합 결과 재검증(S6.2 fail-closed)', () => {
  /**
   * 병합은 두 그래프의 합집합이라 **각각은 비순환인데 합치면 순환**일 수 있다.
   * 사이클 검사는 incoming 에만 걸려 있었으므로, 병합 후 다시 걸지 않으면
   * 순환 그래프가 그대로 영속된다.
   */
  /**
   * `mergeKeepInflight` 의 dangling-0 보장은 **"existing 이 그 자체로 유효하다"는 전제 위에** 있다
   * (함수 docstring 의 `@param existing`). 저장된 그래프가 그 전제를 깨면(레거시·손상 행)
   * 병합 결과도 무효라 `buildTaskGraph` 가 throw 한다 — 그것을 영속하면 이후 디스패치가 죽는다.
   */
  it('저장된 그래프가 무효면(dangling) 영속하지 않고 structural 을 낸다', async () => {
    // 기존 'a' 가 존재하지 않는 'ghost' 에 의존한다 — 전제 위반 상태로 저장돼 있던 행.
    const { repo, upsertGraph } = repoWith([wp('a', ['ghost'])], [['a', 'DISPATCHED']])

    const out = await handleDecompositionEmitted(msg([wp('z')]), { repo, publish: vi.fn().mockResolvedValue('1-0') })

    expect(out).toEqual({ status: 'inconsistent', reason: 'structural' })
    expect(upsertGraph).not.toHaveBeenCalled()
  })

  it('병합이 사이클을 만들면 영속하지 않고 inconsistent 를 낸다', async () => {
    // 기존: a → b (a 가 b 에 의존) · a 는 진행 중이라 보존된다
    // incoming: b → a  → 병합하면 a↔b 순환
    const { repo, upsertGraph } = repoWith([wp('a', ['b']), wp('b')], [['a', 'DISPATCHED']])
    const publish = vi.fn().mockResolvedValue('1-0')

    const out = await handleDecompositionEmitted(msg([wp('b', ['a']), wp('a')]), { repo, publish })

    expect(out).toEqual({ status: 'inconsistent', reason: 'cycle' })
    expect(upsertGraph).not.toHaveBeenCalled()
  })
})
