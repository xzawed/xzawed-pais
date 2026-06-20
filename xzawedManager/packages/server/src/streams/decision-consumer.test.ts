import { describe, it, expect, vi } from 'vitest'
import { buildDecisionRecordedHandler, type DecisionRoutingDeps } from './decision-consumer.js'

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
