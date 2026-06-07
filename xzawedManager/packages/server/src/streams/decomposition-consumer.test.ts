import { describe, it, expect, vi } from 'vitest'
import {
  handleDecompositionEmitted,
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
  envelope: env(over), type: 'decomposition.emitted', payload: { workPackages },
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

describe('DecompositionConsumer', () => {
  it('생성자가 throw하지 않는다(전송 글루)', () => {
    const repo = mockRepo()
    const publish = vi.fn()
    expect(() => new DecompositionConsumer({} as Redis, repo, publish)).not.toThrow()
  })
})
