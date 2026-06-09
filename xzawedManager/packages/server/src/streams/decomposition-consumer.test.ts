import { describe, it, expect, vi } from 'vitest'
import {
  handleDecompositionEmitted,
  buildDecompositionConsumerHandler,
  DecompositionConsumer,
  type DecompositionEmittedMessage,
} from './decomposition-consumer.js'
import type { WorkPackage, EventEnvelope } from '@xzawed/agent-streams'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { Redis } from 'ioredis'

const wp = (id: string, deps: string[] = []): WorkPackage => ({
  id, storyId: 's1', owningRole: 'developer', oracleRef: null,
  acceptanceCriteria: [], dependencies: deps, attributionCounters: {}, status: 'draft',
})

const env = (over: Partial<EventEnvelope> = {}): EventEnvelope => ({
  eventId: 'evt-1', correlationId: 'wf-1', causationId: null, idempotencyKey: 'wf-1:dec:0',
  workflowId: 'wf-1', stepId: 'dec', attemptId: 0, occurredAt: 1000, ...over,
})

const msg = (workPackages: WorkPackage[], over: Partial<EventEnvelope> = {}): DecompositionEmittedMessage => ({
  envelope: env(over), type: 'decomposition.emitted', payload: { workPackages, oracleDrafts: [] },
})

function mockRepo(version = 1) {
  return { upsertGraph: vi.fn().mockResolvedValue({ version }) } as unknown as
    TaskGraphRepo & { upsertGraph: ReturnType<typeof vi.fn> }
}

describe('handleDecompositionEmitted — happy path', () => {
  it('비순환 그래프를 upsertGraph로 영속하고 publish하지 않는다', async () => {
    const repo = mockRepo(1)
    const publish = vi.fn().mockResolvedValue('1-0')
    const out = await handleDecompositionEmitted(msg([wp('a'), wp('b', ['a'])]), { repo, publish })
    expect(repo.upsertGraph).toHaveBeenCalledWith({
      workflowId: 'wf-1', workPackages: [wp('a'), wp('b', ['a'])], eventId: 'evt-1',
    })
    expect(publish).not.toHaveBeenCalled()
    expect(out).toEqual({ status: 'persisted', version: 1 })
  })

  it('upsertGraph의 version을 그대로 전파한다(재분해 version++)', async () => {
    const repo = mockRepo(7)
    const publish = vi.fn().mockResolvedValue('1-0')
    const out = await handleDecompositionEmitted(msg([wp('a')]), { repo, publish })
    expect(out).toEqual({ status: 'persisted', version: 7 })
  })
})

describe('handleDecompositionEmitted — cycle (결정론 에스컬레이션)', () => {
  it('사이클이면 decomposition.inconsistent{cycle}를 발행하고 upsert하지 않는다', async () => {
    const repo = mockRepo()
    const publish = vi.fn().mockResolvedValue('1-0')
    const out = await handleDecompositionEmitted(msg([wp('a', ['b']), wp('b', ['a'])]), { repo, publish, now: () => 5 })
    expect(repo.upsertGraph).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledTimes(1)
    const [stream, message] = publish.mock.calls[0]
    expect(stream).toBe('manager:events:wf-1')
    expect(message.type).toBe('decomposition.inconsistent')
    expect(message.payload.reason).toBe('cycle')
    expect(Array.isArray(message.payload.cycles)).toBe(true)
    expect(message.payload.cycles.length).toBeGreaterThan(0)
    expect(message.envelope.causationId).toBe('evt-1')
    expect(message.envelope.correlationId).toBe('wf-1')
    expect(message.envelope.workflowId).toBe('wf-1')
    expect(message.envelope.stepId).toBe('decomposition.inconsistent')
    expect(message.envelope.occurredAt).toBe(5)
    expect(out).toEqual({ status: 'inconsistent', reason: 'cycle' })
  })
})

describe('handleDecompositionEmitted — structural (build 실패)', () => {
  it('dangling dependency면 inconsistent{structural}를 발행하고 upsert하지 않는다', async () => {
    const repo = mockRepo()
    const publish = vi.fn().mockResolvedValue('1-0')
    const out = await handleDecompositionEmitted(msg([wp('a', ['ghost'])]), { repo, publish })
    expect(repo.upsertGraph).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledTimes(1)
    const [, message] = publish.mock.calls[0]
    expect(message.payload.reason).toBe('structural')
    expect(String(message.payload.detail)).toMatch(/unknown dependency/i)
    expect(out).toEqual({ status: 'inconsistent', reason: 'structural' })
  })

  it('중복 id면 inconsistent{structural}를 발행한다', async () => {
    const repo = mockRepo()
    const publish = vi.fn().mockResolvedValue('1-0')
    const out = await handleDecompositionEmitted(msg([wp('a'), wp('a')]), { repo, publish })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][1].payload.reason).toBe('structural')
    expect(String(publish.mock.calls[0][1].payload.detail)).toMatch(/duplicate/i)
    expect(out).toEqual({ status: 'inconsistent', reason: 'structural' })
  })
})

describe('handleDecompositionEmitted — inconsistentStream override', () => {
  it('주입한 스트림 빌더로 발행한다', async () => {
    const repo = mockRepo()
    const publish = vi.fn().mockResolvedValue('1-0')
    await handleDecompositionEmitted(msg([wp('a', ['b']), wp('b', ['a'])]), {
      repo, publish, inconsistentStream: (w) => `escalation:${w}`,
    })
    expect(publish.mock.calls[0][0]).toBe('escalation:wf-1')
  })
})

describe('handleDecompositionEmitted — upsert 오류 전파(DLQ 경로 보존)', () => {
  it('upsertGraph 실패는 structural로 삼키지 않고 전파한다(BaseConsumer 재시도/DLQ로 위임)', async () => {
    const repo = { upsertGraph: vi.fn().mockRejectedValue(new Error('db down')) } as unknown as
      TaskGraphRepo & { upsertGraph: ReturnType<typeof vi.fn> }
    const publish = vi.fn().mockResolvedValue('1-0')
    await expect(handleDecompositionEmitted(msg([wp('a')]), { repo, publish })).rejects.toThrow('db down')
    expect(publish).not.toHaveBeenCalled() // inconsistent로 오분류되지 않음
  })
})

describe('handleDecompositionEmitted — oracleDrafts upsert (P3-2)', () => {
  const draft = {
    storyId: 's1',
    scenarios: [{ id: 's1-sc1', title: '', given: [], when: '', thenSteps: [], status: 'drafted' as const }],
    coverage: { ac1: ['s1-sc1'] },
  }
  const msgWithDrafts = (drafts: typeof draft[]): DecompositionEmittedMessage => ({
    envelope: env(), type: 'decomposition.emitted', payload: { workPackages: [wp('a')], oracleDrafts: drafts },
  })

  it('oracleStore 주입 + oracleDrafts 있으면 upsertDraft(workflowId·storyId 위임·oracleId 미조립)', async () => {
    const repo = mockRepo(1)
    const oracleStore = { upsertDraft: vi.fn().mockResolvedValue(undefined) }
    const out = await handleDecompositionEmitted(msgWithDrafts([draft]), {
      repo, publish: vi.fn(), oracleStore,
    })
    expect(out).toEqual({ status: 'persisted', version: 1 })
    expect(oracleStore.upsertDraft).toHaveBeenCalledWith({
      workflowId: 'wf-1', storyId: 's1', scenarios: draft.scenarios, coverage: draft.coverage,
    })
  })

  it('여러 draft를 각각 upsertDraft로 위임한다(upsertGraph 성공 후)', async () => {
    const repo = mockRepo(1)
    const oracleStore = { upsertDraft: vi.fn().mockResolvedValue(undefined) }
    await handleDecompositionEmitted(
      msgWithDrafts([draft, { ...draft, storyId: 's2' }]),
      { repo, publish: vi.fn(), oracleStore },
    )
    expect(repo.upsertGraph).toHaveBeenCalled()
    expect(oracleStore.upsertDraft).toHaveBeenCalledTimes(2)
  })

  it('oracleStore 미주입이면 upsert 안 함(회귀 0·persisted)', async () => {
    const repo = mockRepo(1)
    const out = await handleDecompositionEmitted(msgWithDrafts([draft]), { repo, publish: vi.fn() })
    expect(out).toEqual({ status: 'persisted', version: 1 })
  })

  it('oracleStore 주입돼도 oracleDrafts 비면 upsertDraft 미호출', async () => {
    const repo = mockRepo(1)
    const oracleStore = { upsertDraft: vi.fn().mockResolvedValue(undefined) }
    await handleDecompositionEmitted(msgWithDrafts([]), { repo, publish: vi.fn(), oracleStore })
    expect(oracleStore.upsertDraft).not.toHaveBeenCalled()
  })

  it('inconsistent(사이클)이면 upsertDraft 미호출(영속 실패→오라클 미적재)', async () => {
    const repo = mockRepo()
    const oracleStore = { upsertDraft: vi.fn().mockResolvedValue(undefined) }
    const cyc: DecompositionEmittedMessage = {
      envelope: env(), type: 'decomposition.emitted',
      payload: { workPackages: [wp('a', ['b']), wp('b', ['a'])], oracleDrafts: [draft] },
    }
    const out = await handleDecompositionEmitted(cyc, { repo, publish: vi.fn(), oracleStore })
    expect(out.status).toBe('inconsistent')
    expect(oracleStore.upsertDraft).not.toHaveBeenCalled()
  })
})

describe('buildDecompositionConsumerHandler — oracleStore 위임 (P3-2)', () => {
  it('oracleStore를 전달하면 영속 후 upsertDraft 호출', async () => {
    const repo = mockRepo(1)
    const oracleStore = { upsertDraft: vi.fn().mockResolvedValue(undefined) }
    const msgWithDrafts: DecompositionEmittedMessage = {
      envelope: env(), type: 'decomposition.emitted',
      payload: {
        workPackages: [wp('a')],
        oracleDrafts: [{ storyId: 's1', scenarios: [{ id: 's1-sc1', title: '', given: [], when: '', thenSteps: [], status: 'drafted' }], coverage: {} }],
      },
    }
    const handler = buildDecompositionConsumerHandler(repo, vi.fn(), undefined, oracleStore)
    await handler(msgWithDrafts)
    expect(oracleStore.upsertDraft).toHaveBeenCalledTimes(1)
  })
})

describe('DecompositionConsumer', () => {
  it('생성자가 throw하지 않는다(전송 글루)', () => {
    const repo = mockRepo()
    const publish = vi.fn()
    expect(() => new DecompositionConsumer({} as Redis, repo, publish)).not.toThrow()
  })

  it('oracleStore 6번째 인자를 받아도 throw하지 않는다(P3-2)', () => {
    const repo = mockRepo()
    const oracleStore = { upsertDraft: vi.fn() }
    expect(
      () => new DecompositionConsumer({} as Redis, repo, vi.fn(), undefined, undefined, oracleStore),
    ).not.toThrow()
  })
})

describe('buildDecompositionConsumerHandler (P1d-7 afterPersisted 훅)', () => {
  it('영속 성공 시 afterPersisted를 workflowId로 호출한다', async () => {
    const repo = mockRepo(1)
    const publish = vi.fn().mockResolvedValue('1-0')
    const afterPersisted = vi.fn().mockResolvedValue(undefined)
    const handler = buildDecompositionConsumerHandler(repo, publish, afterPersisted)
    await handler(msg([wp('a'), wp('b', ['a'])]))
    expect(repo.upsertGraph).toHaveBeenCalled()
    expect(afterPersisted).toHaveBeenCalledWith('wf-1')
  })

  it('사이클(inconsistent)이면 afterPersisted를 호출하지 않는다', async () => {
    const repo = mockRepo()
    const publish = vi.fn().mockResolvedValue('1-0')
    const afterPersisted = vi.fn().mockResolvedValue(undefined)
    const handler = buildDecompositionConsumerHandler(repo, publish, afterPersisted)
    await handler(msg([wp('a', ['b']), wp('b', ['a'])]))
    expect(publish).toHaveBeenCalled() // inconsistent
    expect(repo.upsertGraph).not.toHaveBeenCalled()
    expect(afterPersisted).not.toHaveBeenCalled()
  })

  it('afterPersisted 미전달이면 영속만 하고 throw하지 않는다(회귀)', async () => {
    const repo = mockRepo(1)
    const publish = vi.fn().mockResolvedValue('1-0')
    const handler = buildDecompositionConsumerHandler(repo, publish)
    await expect(handler(msg([wp('a')]))).resolves.toBeUndefined()
    expect(repo.upsertGraph).toHaveBeenCalled()
  })
})
