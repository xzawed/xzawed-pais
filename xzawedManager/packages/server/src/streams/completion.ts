import { handleDispatch, type DispatchDeps, type DispatchOutcome } from './dispatch.js'
import type { LeaseStore } from '../db/lease.repo.js'
import { LEASE_ACTIVE } from './dispatch-constants.js'
import { allWpDone, doneSetVersion, evaluateReleaseGate } from './release-gate.js'
import type { ChannelOutcome, ReleaseGateResult } from '../db/release-gate.types.js'

export interface CompletionDeps {
  leaseStore: LeaseStore
  dispatch: DispatchDeps
  /** P5-1 릴리스 게이트: all-WP-done 시 평가·영속(best-effort). 미주입이면 미평가(회귀 0). */
  releaseGateEnabled?: boolean
  releaseStore?: {
    evidenceForWorkflow(workflowId: string): Promise<Map<string, ChannelOutcome[]>>
    recordGate(workflowId: string, gateVersion: string, result: ReleaseGateResult): Promise<{ eventId: string } | null>
  }
}

export interface CompletionOutcome {
  status: 'completed' | 'skipped'
  /** 완료로 unblock돼 새로 디스패치된 후행 노드. */
  dispatched: DispatchOutcome['dispatched']
  eventId?: string
  /** P5-1: 게이트 평가 결과(all-WP-done 시만 설정). */
  gate?: ReleaseGateResult['status']
}

/**
 * WP 완료 흐름: getLease(active 확인) → recordCompletion(lease release·DISPATCHED→DONE) →
 * handleDispatch 재디스패치(완료가 latestStates done-set에 반영돼 후행 unblock). 디스패치 루프를 닫는다.
 */
export async function handleCompletion(
  workflowId: string, wpId: string, deps: CompletionDeps,
): Promise<CompletionOutcome> {
  const lease = await deps.leaseStore.getLease(workflowId, wpId)
  if (!lease || lease.status !== LEASE_ACTIVE) return { status: 'skipped', dispatched: [] }

  const c = await deps.leaseStore.recordCompletion({
    workflowId, wpId, attempt: lease.attempt, stepN: lease.stepN,
  })
  if (c.status === 'skipped') return { status: 'skipped', dispatched: [] }

  // 완료가 done-set에 반영돼 후행 unblock → 재디스패치
  const redispatch = await handleDispatch(workflowId, deps.dispatch)
  const gate = await maybeEvaluateReleaseGate(workflowId, deps)
  return { status: 'completed', dispatched: redispatch.dispatched, eventId: c.eventId, ...(gate !== undefined && { gate }) }
}

/** all-WP-done이면 게이트 평가·영속(never-throw best-effort). 반환 = 게이트 상태(미평가 시 undefined). */
async function maybeEvaluateReleaseGate(workflowId: string, deps: CompletionDeps): Promise<ReleaseGateResult['status'] | undefined> {
  if (deps.releaseGateEnabled !== true || !deps.releaseStore) return undefined
  try {
    const stored = await deps.dispatch.repo.getGraph(workflowId)
    if (!stored) return undefined
    const states = await deps.dispatch.repo.latestStates(workflowId)
    if (!allWpDone(stored.workPackages, states)) return undefined
    const evidence = await deps.releaseStore.evidenceForWorkflow(workflowId)
    const result = evaluateReleaseGate(stored.workPackages, evidence)
    const version = doneSetVersion(states)
    await deps.releaseStore.recordGate(workflowId, version, result)
    return result.status
  } catch (err) {
    console.error('[completion] 릴리스 게이트 평가 실패(fail-closed: 미발행은 promote 차단):', err)
    return undefined
  }
}
