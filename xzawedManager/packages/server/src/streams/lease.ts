import type { LeaseRecord, LeaseStore } from '../db/lease.repo.js'
import { DEFAULT_MAX_ATTEMPTS, DEFAULT_VISIBILITY_MS } from './dispatch-constants.js'
import { publishDispatchSignal } from './dispatch-signal.js'
import type { Publish } from './decomposition-consumer.js'

export interface ReclaimItem {
  workflowId: string
  wpId: string
  stepN: number
  attempt: number
  nextAttempt: number
  action: 'reclaim' | 'escalate'
}

/**
 * 만료 lease를 reclaim/escalate로 분류(순수): nextAttempt = attempt+1.
 * nextAttempt < maxAttempts면 reclaim(재할당), 아니면 escalate(상한 초과 사람). 입력 순서 보존·결정론.
 */
export function planReclaim(expired: LeaseRecord[], opts: { maxAttempts: number }): ReclaimItem[] {
  return expired.map((l) => {
    const nextAttempt = l.attempt + 1
    return {
      workflowId: l.workflowId,
      wpId: l.wpId,
      stepN: l.stepN,
      attempt: l.attempt,
      nextAttempt,
      action: nextAttempt < opts.maxAttempts ? 'reclaim' : 'escalate',
    }
  })
}

export interface SweepDeps {
  store: LeaseStore
  /** 최대 디스패치 시도. 기본 DEFAULT_MAX_ATTEMPTS. */
  maxAttempts?: number
  /** reclaim 시 새 lease 만료(ms). 기본 DEFAULT_VISIBILITY_MS. */
  visibilityMs?: number
  /** P4-1: 주입 시 reclaim 후 wp.dispatch_signal 발행(워커 재실행 트리거). 미주입이면 무발행. */
  publish?: Publish
}

export interface SweepOutcome {
  reclaimed: Array<{ workflowId: string; wpId: string; nextAttempt: number; eventId: string }>
  escalated: Array<{ workflowId: string; wpId: string; eventId: string }>
  /** 동시 sweep이 선점해 skip된 항목 수. */
  skipped: number
}

/**
 * lease 만료 sweep: expiredActiveLeases → planReclaim → 항목별 원자 recordReclaim/recordEscalation.
 * handleDispatch 대칭(조회·계획·원자 적재 분리). 실제 타이머 구동은 후속(server.ts 배선).
 */
export async function handleLeaseSweep(now: number, deps: SweepDeps): Promise<SweepOutcome> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const visibilityMs = deps.visibilityMs ?? DEFAULT_VISIBILITY_MS
  const expired = await deps.store.expiredActiveLeases(now)
  const plan = planReclaim(expired, { maxAttempts })

  const reclaimed: SweepOutcome['reclaimed'] = []
  const escalated: SweepOutcome['escalated'] = []
  let skipped = 0
  for (const item of plan) {
    if (item.action === 'reclaim') {
      const r = await deps.store.recordReclaim({
        workflowId: item.workflowId, wpId: item.wpId, nextAttempt: item.nextAttempt, stepN: item.stepN, visibilityMs,
      })
      if (r.status === 'reclaimed') {
        reclaimed.push({ workflowId: item.workflowId, wpId: item.wpId, nextAttempt: item.nextAttempt, eventId: r.eventId })
        if (deps.publish) await publishDispatchSignal(deps.publish, item.workflowId, item.wpId, item.nextAttempt, now)
      } else skipped += 1
    } else {
      const r = await deps.store.recordEscalation({
        workflowId: item.workflowId, wpId: item.wpId, attempt: item.attempt, stepN: item.stepN,
      })
      if (r.status === 'escalated') escalated.push({ workflowId: item.workflowId, wpId: item.wpId, eventId: r.eventId })
      else skipped += 1
    }
  }
  return { reclaimed, escalated, skipped }
}
