import { handleDispatch, type DispatchDeps, type DispatchOutcome } from './dispatch.js'
import type { LeaseStore } from '../db/lease.repo.js'
import { LEASE_ACTIVE } from './dispatch-constants.js'

export interface CompletionDeps {
  leaseStore: LeaseStore
  dispatch: DispatchDeps
}

export interface CompletionOutcome {
  status: 'completed' | 'skipped'
  /** 완료로 unblock돼 새로 디스패치된 후행 노드. */
  dispatched: DispatchOutcome['dispatched']
  eventId?: string
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
  return { status: 'completed', dispatched: redispatch.dispatched, eventId: c.eventId }
}
