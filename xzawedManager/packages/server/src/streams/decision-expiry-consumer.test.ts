import { describe, it, expect, vi } from 'vitest'
import { parseReescDepth, stripReescSuffix, nextReescId } from './decision-expiry-consumer.js'
import { buildDecisionExpiredHandler, type DecisionExpiryStore } from './decision-expiry-consumer.js'
import { DecisionExpiredConsumer } from './decision-expiry-consumer.js'
import { DECISION_EXPIRED_EVENT } from '../db/decision.types.js'

// ---------------------------------------------------------------------------
// Task 1: 재에스컬 깊이 헬퍼
// ---------------------------------------------------------------------------

describe('재에스컬 깊이 헬퍼', () => {
  it('parseReescDepth: 접미사 없으면 0, :reesc{n} 있으면 n', () => {
    expect(parseReescDepth('wf-1:wp-2:0')).toBe(0)
    expect(parseReescDepth('wf-1:wp-2:0:reesc1')).toBe(1)
    expect(parseReescDepth('wf-1:wp-2:0:reesc2')).toBe(2)
  })

  it('stripReescSuffix: 끝의 :reesc{n}만 제거(base의 colon 보존)', () => {
    expect(stripReescSuffix('wf-1:wp-2:0')).toBe('wf-1:wp-2:0')
    expect(stripReescSuffix('wf-1:wp-2:0:reesc1')).toBe('wf-1:wp-2:0')
    expect(stripReescSuffix('wf-1:wp-2:0:reesc2')).toBe('wf-1:wp-2:0')
  })

  it('nextReescId: 원본 base에 고정해 depth+1 부여', () => {
    expect(nextReescId('wf-1:wp-2:0')).toBe('wf-1:wp-2:0:reesc1')
    expect(nextReescId('wf-1:wp-2:0:reesc1')).toBe('wf-1:wp-2:0:reesc2')
  })
})

// ---------------------------------------------------------------------------
// Task 2: buildDecisionExpiredHandler
// ---------------------------------------------------------------------------

function makeReq(over: Partial<Record<string, unknown>> = {}) {
  return {
    requestId: 'wf-1:wp-2:0',
    type: 'defect_brief' as const,
    workflowId: 'wf-1',
    wpId: 'wp-2',
    correlationId: 'wf-1',
    projectId: 'proj-1',
    context: { impact: ['boom'], evidenceRefs: [], options: [] },
    severity: 'blocking' as const,
    status: 'EXPIRED' as const,
    language: 'ko',
    expiresAt: null,
    ...over,
  }
}

function msg(requestId: string) {
  return {
    envelope: { workflowId: 'wf-1' },
    type: DECISION_EXPIRED_EVENT,
    payload: { requestId, status: 'EXPIRED', workflowId: 'wf-1' },
  } as Parameters<ReturnType<typeof buildDecisionExpiredHandler>>[0]
}

function makeStore(req: ReturnType<typeof makeReq> | null): DecisionExpiryStore & { createRequest: ReturnType<typeof vi.fn> } {
  return {
    getRequest: vi.fn().mockResolvedValue(req),
    createRequest: vi.fn().mockResolvedValue({ eventId: 'e1' }),
  }
}

describe('buildDecisionExpiredHandler', () => {
  it('비-expired type → no-op(getRequest 미호출)', async () => {
    const store = makeStore(makeReq())
    await buildDecisionExpiredHandler({ decisionStore: store, maxReescalations: 1, ttlMs: 1000, now: () => 0 })({
      ...msg('wf-1:wp-2:0'),
      type: 'decision.recorded',
    } as Parameters<ReturnType<typeof buildDecisionExpiredHandler>>[0])
    expect(store.getRequest).not.toHaveBeenCalled()
  })

  it('blocking depth 0 → createRequest nextId=base:reesc1·expiresAt·orig 필드 복사·impact 표식', async () => {
    const store = makeStore(makeReq())
    await buildDecisionExpiredHandler({ decisionStore: store, maxReescalations: 1, ttlMs: 1000, now: () => 0 })(msg('wf-1:wp-2:0'))
    expect(store.createRequest).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const arg = store.createRequest.mock.calls[0][0] as Record<string, unknown>
    expect(arg['requestId']).toBe('wf-1:wp-2:0:reesc1')
    expect(arg['type']).toBe('defect_brief')
    expect(arg['wpId']).toBe('wp-2')
    expect(arg['projectId']).toBe('proj-1')
    expect(arg['expiresAt']).toBe(new Date(1000).toISOString())
    expect((arg['context'] as { impact: string[] }).impact).toContain('re-escalated from wf-1:wp-2:0 (attempt 1)')
  })

  it('advisory severity → no-op(재에스컬 안 함)', async () => {
    const store = makeStore(makeReq({ severity: 'advisory' }))
    await buildDecisionExpiredHandler({ decisionStore: store, maxReescalations: 1, ttlMs: 1000, now: () => 0 })(msg('wf-1:wp-2:0'))
    expect(store.createRequest).not.toHaveBeenCalled()
  })

  it('depth >= max(1) → createRequest 미호출(종단)', async () => {
    const store = makeStore(makeReq({ requestId: 'wf-1:wp-2:0:reesc1' }))
    await buildDecisionExpiredHandler({ decisionStore: store, maxReescalations: 1, ttlMs: 1000, now: () => 0 })(msg('wf-1:wp-2:0:reesc1'))
    expect(store.createRequest).not.toHaveBeenCalled()
  })

  it('getRequest null → no-op', async () => {
    const store = makeStore(null)
    await buildDecisionExpiredHandler({ decisionStore: store, maxReescalations: 1, ttlMs: 1000, now: () => 0 })(msg('wf-1:wp-2:0'))
    expect(store.createRequest).not.toHaveBeenCalled()
  })

  it('createRequest throw → never-throw(흡수)', async () => {
    const store = makeStore(makeReq())
    store.createRequest.mockRejectedValue(new Error('db down'))
    await expect(
      buildDecisionExpiredHandler({ decisionStore: store, maxReescalations: 1, ttlMs: 1000, now: () => 0 })(msg('wf-1:wp-2:0')),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Task 3: DecisionExpiredConsumer (BaseConsumer 서브클래스)
// ---------------------------------------------------------------------------

describe('DecisionExpiredConsumer', () => {
  it('BaseConsumer 서브클래스로 생성된다(start/stop 보유)', () => {
    const redis = {} as Parameters<typeof DecisionExpiredConsumer.prototype.constructor>[0]
    const c = new DecisionExpiredConsumer(redis, {
      decisionStore: { getRequest: async () => null, createRequest: async () => null },
      maxReescalations: 1,
      ttlMs: 1000,
    })
    expect(typeof c.start).toBe('function')
    expect(typeof c.stop).toBe('function')
  })
})
