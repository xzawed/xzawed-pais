import { describe, it, expect, vi } from 'vitest'
import { buildDecisionRecordedHandler, groupScopedDedupKey, type DecisionRoutingDeps, type DecisionEventMessage } from './decision-consumer.js'

function recordedMsg(choice: string, requestId = 'wf-1:wp_a:2') {
  return { envelope: { workflowId: 'wf-1' }, type: 'decision.recorded', payload: { decisionId: 'd1', requestId, choice, routedTo: 'impl', decidedBy: 'po' } } as never
}
function deps(over: Partial<DecisionRoutingDeps> = {}): DecisionRoutingDeps {
  return {
    decisionStore: { getRequest: vi.fn().mockResolvedValue({ workflowId: 'wf-1', wpId: 'wp_a' }) } as never,
    leaseStore: { reopenLease: vi.fn().mockResolvedValue({ status: 'reopened', eventId: 'e1', seq: 1, attempt: 3 }) } as never,
    publish: vi.fn().mockResolvedValue(undefined),
    visibilityMs: 300000,
    ...over,
  }
}
describe('buildDecisionRecordedHandler (P6 fix_reverify)', () => {
  it('fix_reverify → reopenLease(causationId=requestId) + dispatch_signal(advanced attempt)', async () => {
    const d = deps()
    await buildDecisionRecordedHandler(d)(recordedMsg('fix_reverify'))
    expect(d.leaseStore.reopenLease).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-1', wpId: 'wp_a', visibilityMs: 300000, causationId: 'wf-1:wp_a:2' }))
    expect(d.publish).toHaveBeenCalled()
    // dispatch_signal은 reopen이 반환한 advanced attempt(3)로 발행 — attempt 0이면 원 dispatch 멱등키와 충돌해 dedup 드롭
    const signalMsg = (d.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[1] as { payload?: { attempt?: number } } | undefined
    expect(signalMsg?.payload?.attempt).toBe(3)
  })
  it('reopen skip → dispatch_signal 미발행', async () => {
    const d = deps({ leaseStore: { reopenLease: vi.fn().mockResolvedValue({ status: 'skipped' }) } as never })
    await buildDecisionRecordedHandler(d)(recordedMsg('fix_reverify'))
    expect(d.publish).not.toHaveBeenCalled()
  })
  it('getRequest 부재 → no-op', async () => {
    const d = deps({ decisionStore: { getRequest: vi.fn().mockResolvedValue(null) } as never })
    await buildDecisionRecordedHandler(d)(recordedMsg('fix_reverify'))
    expect(d.leaseStore.reopenLease).not.toHaveBeenCalled()
  })
  it('spec_fix/reject/accept_known → no-op', async () => {
    for (const c of ['spec_fix', 'reject', 'accept_known']) {
      const d = deps()
      await buildDecisionRecordedHandler(d)(recordedMsg(c))
      expect(d.leaseStore.reopenLease).not.toHaveBeenCalled()
    }
  })
  it('decision.requested(다른 type) → no-op(스키마 통과·DLQ 아님)', async () => {
    const d = deps()
    const msg = { envelope: { workflowId: 'wf-1' }, type: 'decision.requested', payload: { requestId: 'r1', type: 'defect_brief' } } as never
    await buildDecisionRecordedHandler(d)(msg)
    expect(d.leaseStore.reopenLease).not.toHaveBeenCalled()
  })
  it('reopenLease throw → 흡수(never-throw)', async () => {
    const d = deps({ leaseStore: { reopenLease: vi.fn().mockRejectedValue(new Error('boom')) } as never })
    await expect(buildDecisionRecordedHandler(d)(recordedMsg('fix_reverify'))).resolves.toBeUndefined()
  })
})

// 핸들러는 msg.type·msg.payload만 읽으므로 envelope는 캐스트로 충분(BaseConsumer가 스키마 검증 담당).
const rec = (payload: Record<string, unknown>) => ({ type: 'decision.recorded', payload } as never)

describe('buildDecisionRecordedHandler accept_known 사인오프 (P5-2a)', () => {
  const degraded = { requestId: 'wf-1:gate:v1', type: 'degraded_release', workflowId: 'wf-1', wpId: null }
  function deps2(over: Record<string, unknown> = {}) {
    return {
      decisionStore: { getRequest: vi.fn().mockResolvedValue(degraded) },
      leaseStore: { reopenLease: vi.fn() },
      publish: vi.fn(), visibilityMs: 1000,
      signoffStore: { recordSignOff: vi.fn().mockResolvedValue({ eventId: 'e1' }) },
      ...over,
    } as never
  }
  it('accept_known + degraded_release → recordSignOff(scope=release·approver·signoffId)', async () => {
    const d = deps2()
    await buildDecisionRecordedHandler(d)(rec({ requestId: 'wf-1:gate:v1', choice: 'accept_known', decisionId: 'wf-1:gate:v1:accept_known', decidedBy: 'po-7' }))
    expect((d as { signoffStore: { recordSignOff: ReturnType<typeof vi.fn> } }).signoffStore.recordSignOff).toHaveBeenCalledWith(expect.objectContaining({
      decisionId: 'wf-1:gate:v1:accept_known', signoffId: 'wf-1:gate:v1:accept_known:signoff', scope: 'release', approver: 'po-7',
    }))
  })
  it('accept_known + defect_brief(다른 type) → no-op', async () => {
    const recordSignOff = vi.fn()
    const d = deps2({ decisionStore: { getRequest: vi.fn().mockResolvedValue({ requestId: 'r', type: 'defect_brief', workflowId: 'wf', wpId: 'wp-a' }) }, signoffStore: { recordSignOff } })
    await buildDecisionRecordedHandler(d)(rec({ requestId: 'r', choice: 'accept_known', decisionId: 'd', decidedBy: 'po' }))
    expect(recordSignOff).not.toHaveBeenCalled()
  })
  it('fix_reverify on degraded_release(wpId null) → reopenLease 미호출(기존 가드)', async () => {
    const reopenLease = vi.fn()
    const d = deps2({ leaseStore: { reopenLease } })
    await buildDecisionRecordedHandler(d)(rec({ requestId: 'wf-1:gate:v1', choice: 'fix_reverify', decisionId: 'd', decidedBy: 'po' }))
    expect(reopenLease).not.toHaveBeenCalled()
  })
  it('signoffStore 미주입 → accept_known no-op(never-throw)', async () => {
    const d = deps2({ signoffStore: undefined })
    await expect(buildDecisionRecordedHandler(d)(rec({ requestId: 'wf-1:gate:v1', choice: 'accept_known', decisionId: 'd', decidedBy: 'po' }))).resolves.toBeUndefined()
  })
})

describe('buildDecisionRecordedHandler approve 위험분류 (C5)', () => {
  it('approve + risk_classification → riskStore.approve(workflowId, decidedBy)', async () => {
    const riskStore = { approve: vi.fn().mockResolvedValue({ eventId: 'ev' }) }
    const decisionStore = { getRequest: vi.fn().mockResolvedValue({ requestId: 'wf:risk:1', workflowId: 'wf', type: 'risk_classification', wpId: null }) }
    const d = {
      decisionStore,
      leaseStore: {} as never,
      publish: vi.fn(),
      visibilityMs: 1000,
      riskStore,
    } as never
    await buildDecisionRecordedHandler(d)(rec({ requestId: 'wf:risk:1', choice: 'approve', decisionId: 'wf:risk:1:approve', decidedBy: 'alice' }))
    expect(riskStore.approve).toHaveBeenCalledWith('wf', 'alice')
  })
  it('approve이지만 type이 risk_classification 아니면 no-op', async () => {
    const riskStore = { approve: vi.fn() }
    const decisionStore = { getRequest: vi.fn().mockResolvedValue({ requestId: 'r', workflowId: 'wf', type: 'defect_brief', wpId: 'wp' }) }
    const d = {
      decisionStore,
      leaseStore: {} as never,
      publish: vi.fn(),
      visibilityMs: 1000,
      riskStore,
    } as never
    await buildDecisionRecordedHandler(d)(rec({ requestId: 'r', choice: 'approve', decisionId: 'd', decidedBy: 'a' }))
    expect(riskStore.approve).not.toHaveBeenCalled()
  })
  it('riskStore 미주입 → approve no-op(never-throw)', async () => {
    const decisionStore = { getRequest: vi.fn().mockResolvedValue({ requestId: 'wf:risk:1', workflowId: 'wf', type: 'risk_classification', wpId: null }) }
    const d = {
      decisionStore,
      leaseStore: {} as never,
      publish: vi.fn(),
      visibilityMs: 1000,
    } as never
    await expect(buildDecisionRecordedHandler(d)(rec({ requestId: 'wf:risk:1', choice: 'approve', decisionId: 'd', decidedBy: 'alice' }))).resolves.toBeUndefined()
  })
  it('decidedBy 미주입 → approve no-op', async () => {
    const riskStore = { approve: vi.fn() }
    const decisionStore = { getRequest: vi.fn().mockResolvedValue({ requestId: 'wf:risk:1', workflowId: 'wf', type: 'risk_classification', wpId: null }) }
    const d = {
      decisionStore,
      leaseStore: {} as never,
      publish: vi.fn(),
      visibilityMs: 1000,
      riskStore,
    } as never
    await buildDecisionRecordedHandler(d)(rec({ requestId: 'wf:risk:1', choice: 'approve', decisionId: 'd' }))
    expect(riskStore.approve).not.toHaveBeenCalled()
  })
})

describe('buildDecisionRecordedHandler approve golden 사인오프 (Slice 1)', () => {
  function deps3(over: Record<string, unknown> = {}, reqType = 'golden_diff') {
    return {
      decisionStore: { getRequest: vi.fn().mockResolvedValue({ requestId: 'wf:golden', workflowId: 'wf', type: reqType, wpId: null }) },
      leaseStore: {} as never, publish: vi.fn(), visibilityMs: 1000,
      ...over,
    } as never
  }
  it('approve + golden_diff → oracleStore.freezeGoldensByWorkflow(workflowId, decidedBy)', async () => {
    const freezeGoldensByWorkflow = vi.fn().mockResolvedValue({ frozen: 2 })
    const d = deps3({ oracleStore: { approvePendingByWorkflow: vi.fn(), freezeGoldensByWorkflow } })
    await buildDecisionRecordedHandler(d)(rec({ requestId: 'wf:golden', choice: 'approve', decisionId: 'wf:golden:approve', decidedBy: 'po' }))
    expect(freezeGoldensByWorkflow).toHaveBeenCalledWith('wf', 'po')
  })
  it('approve + golden_diff이지만 freezeGoldensByWorkflow 미주입 → no-op(never-throw)', async () => {
    const approvePendingByWorkflow = vi.fn()
    const d = deps3({ oracleStore: { approvePendingByWorkflow } })
    await expect(buildDecisionRecordedHandler(d)(rec({ requestId: 'wf:golden', choice: 'approve', decisionId: 'd', decidedBy: 'po' }))).resolves.toBeUndefined()
    expect(approvePendingByWorkflow).not.toHaveBeenCalled() // oracle_approval 경로 미발화(type 불일치)
  })
  it('approve + oracle_approval은 freeze 아닌 approvePendingByWorkflow(기존 분기 보존)', async () => {
    const approvePendingByWorkflow = vi.fn().mockResolvedValue({ approved: 1 })
    const freezeGoldensByWorkflow = vi.fn()
    const d = deps3({ oracleStore: { approvePendingByWorkflow, freezeGoldensByWorkflow } }, 'oracle_approval')
    await buildDecisionRecordedHandler(d)(rec({ requestId: 'wf:oracle', choice: 'approve', decisionId: 'd', decidedBy: 'po' }))
    expect(approvePendingByWorkflow).toHaveBeenCalledWith('wf', 'po')
    expect(freezeGoldensByWorkflow).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// B1 동시성: groupScopedDedupKey — 두 그룹 멱등 마커 충돌 차단
// ---------------------------------------------------------------------------

const RECORDED_GROUP = 'manager-decision-consumers'
const EXPIRY_GROUP = 'manager-decision-expiry-consumers'

function makeDecisionMsg(idempotencyKey: string): DecisionEventMessage {
  return {
    envelope: { idempotencyKey } as never,
    type: 'decision.expired',
    payload: { requestId: 'wf-1:wp-a:0' },
  }
}

describe('groupScopedDedupKey (B1 그룹-스코프 dedup)', () => {
  it('같은 메시지에 대해 두 그룹의 키가 서로 다르다(DISJOINT — 핵심 불변식)', () => {
    const m = makeDecisionMsg('idem-1')
    const k1 = groupScopedDedupKey(RECORDED_GROUP, m)
    const k2 = groupScopedDedupKey(EXPIRY_GROUP, m)
    expect(k1).not.toBeNull()
    expect(k2).not.toBeNull()
    expect(k1).not.toBe(k2)
  })

  it('각 키는 해당 그룹 이름으로 시작한다', () => {
    const m = makeDecisionMsg('idem-1')
    expect(groupScopedDedupKey(RECORDED_GROUP, m)).toMatch(new RegExp(`^${RECORDED_GROUP}:`))
    expect(groupScopedDedupKey(EXPIRY_GROUP, m)).toMatch(new RegExp(`^${EXPIRY_GROUP}:`))
  })

  it('같은 (그룹, 메시지) 쌍은 항상 동일한 키를 반환한다(within-group dedup 보존)', () => {
    const m = makeDecisionMsg('idem-stable')
    expect(groupScopedDedupKey(RECORDED_GROUP, m)).toBe(groupScopedDedupKey(RECORDED_GROUP, m))
    expect(groupScopedDedupKey(EXPIRY_GROUP, m)).toBe(groupScopedDedupKey(EXPIRY_GROUP, m))
  })

  it('envelope.idempotencyKey와 messageId 모두 없으면 null 반환(dedup-skip 보존)', () => {
    const m: DecisionEventMessage = {
      envelope: {} as never,
      type: 'decision.expired',
      payload: { requestId: 'wf-1:wp-a:0' },
    }
    expect(groupScopedDedupKey(RECORDED_GROUP, m)).toBeNull()
    expect(groupScopedDedupKey(EXPIRY_GROUP, m)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// C3: approve oracle_approval → oracleStore.approvePendingByWorkflow
// ---------------------------------------------------------------------------

describe('buildDecisionRecordedHandler C3 oracle_approval', () => {
  it('C3: approve + oracle_approval → oracleStore.approvePendingByWorkflow 호출', async () => {
    const approvePendingByWorkflow = vi.fn().mockResolvedValue({ approved: 2 })
    const getRequest = vi.fn().mockResolvedValue({ type: 'oracle_approval', workflowId: 'wf-1', wpId: null })
    const handler = buildDecisionRecordedHandler({
      decisionStore: { getRequest },
      leaseStore: { reopenLease: vi.fn() },
      publish: vi.fn(),
      visibilityMs: 1000,
      oracleStore: { approvePendingByWorkflow },
    } as unknown as Parameters<typeof buildDecisionRecordedHandler>[0])
    await handler(rec({ requestId: 'wf-1:oracle', choice: 'approve', decisionId: 'd1', decidedBy: 'user-7' }))
    expect(approvePendingByWorkflow).toHaveBeenCalledWith('wf-1', 'user-7')
  })

  it('C3: approve + risk_classification 기존 경로 보존(회귀 0)', async () => {
    const riskApprove = vi.fn().mockResolvedValue({ eventId: 'e' })
    const getRequest = vi.fn().mockResolvedValue({ type: 'risk_classification', workflowId: 'wf-2', wpId: null })
    const handler = buildDecisionRecordedHandler({
      decisionStore: { getRequest },
      leaseStore: { reopenLease: vi.fn() },
      publish: vi.fn(),
      visibilityMs: 1000,
      riskStore: { approve: riskApprove },
    } as unknown as Parameters<typeof buildDecisionRecordedHandler>[0])
    await handler(rec({ requestId: 'wf-2:risk:1', choice: 'approve', decisionId: 'd2', decidedBy: 'user-8' }))
    expect(riskApprove).toHaveBeenCalledWith('wf-2', 'user-8')
  })

  it('C3: oracleStore 미주입 → approve oracle_approval no-op(never-throw)', async () => {
    const getRequest = vi.fn().mockResolvedValue({ type: 'oracle_approval', workflowId: 'wf-1', wpId: null })
    const handler = buildDecisionRecordedHandler({
      decisionStore: { getRequest },
      leaseStore: { reopenLease: vi.fn() },
      publish: vi.fn(),
      visibilityMs: 1000,
    } as unknown as Parameters<typeof buildDecisionRecordedHandler>[0])
    await expect(handler(rec({ requestId: 'wf-1:oracle', choice: 'approve', decisionId: 'd1', decidedBy: 'user-7' }))).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// N2: accept_known degraded_dispatch + redispatch
// ---------------------------------------------------------------------------

describe('buildDecisionRecordedHandler N2 degraded_dispatch', () => {
  it('N2: accept_known + degraded_dispatch → recordSignOff(scope degraded_dispatch) + redispatch', async () => {
    const recordSignOff = vi.fn().mockResolvedValue({ eventId: 'e1' })
    const redispatch = vi.fn().mockResolvedValue(undefined)
    const getRequest = vi.fn().mockResolvedValue({ requestId: 'r1', type: 'degraded_dispatch', workflowId: 'wf-1', wpId: 'wp-a' })
    const handler = buildDecisionRecordedHandler({
      decisionStore: { getRequest }, leaseStore: { reopenLease: vi.fn() }, publish: vi.fn(), visibilityMs: 1000,
      signoffStore: { recordSignOff }, redispatch,
    } as never)
    await handler({ envelope: { workflowId: 'wf-1' } as never, type: 'decision.recorded', payload: { requestId: 'r1', choice: 'accept_known', decisionId: 'd1', decidedBy: 'alice' } } as never)
    expect(recordSignOff).toHaveBeenCalledWith(expect.objectContaining({ scope: 'degraded_dispatch', approver: 'alice', decisionId: 'd1' }))
    expect(redispatch).toHaveBeenCalledWith('wf-1')
  })

  it('N2: accept_known + degraded_release는 기존 동작 보존(scope release·redispatch 미호출)', async () => {
    const recordSignOff = vi.fn().mockResolvedValue({ eventId: 'e1' })
    const redispatch = vi.fn().mockResolvedValue(undefined)
    const getRequest = vi.fn().mockResolvedValue({ requestId: 'r1', type: 'degraded_release', workflowId: 'wf-1', wpId: null })
    const handler = buildDecisionRecordedHandler({
      decisionStore: { getRequest }, leaseStore: { reopenLease: vi.fn() }, publish: vi.fn(), visibilityMs: 1000,
      signoffStore: { recordSignOff }, redispatch,
    } as never)
    await handler({ envelope: { workflowId: 'wf-1' } as never, type: 'decision.recorded', payload: { requestId: 'r1', choice: 'accept_known', decisionId: 'd1', decidedBy: 'alice' } } as never)
    expect(recordSignOff).toHaveBeenCalledWith(expect.objectContaining({ scope: 'release' }))
    expect(redispatch).not.toHaveBeenCalled()
  })
})
