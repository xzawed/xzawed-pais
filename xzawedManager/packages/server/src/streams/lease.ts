import type { LeaseRecord, LeaseStore } from '../db/lease.repo.js'
import { DEFAULT_MAX_ATTEMPTS, DEFAULT_VISIBILITY_MS } from './dispatch-constants.js'
import { publishDispatchSignal } from './dispatch-signal.js'
import type { Publish } from './decomposition-consumer.js'

/** projectId 조회용 좁은 포트(TaskGraphRepo가 구조적 충족). 결정 브리프에 프로젝트 스코프 부여. */
export interface GraphQueryPort {
  getGraph(workflowId: string): Promise<{ userContext: { projectId: string } | null } | null>
}

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
  /** P6: 주입 시 escalate 성공 후 결함 브리프(DecisionRequest) 생성. best-effort(throw는 sweep 비차단). */
  onEscalated?: (info: { workflowId: string; wpId: string; attempt: number; stepN: number; projectId?: string | null }) => Promise<void>
  /** C0/C1: 주입 시 escalate 결함 브리프에 projectId(getGraph.userContext) 부여. 미주입/실패는 null(N3). */
  graphStore?: GraphQueryPort
}

export interface SweepOutcome {
  reclaimed: Array<{ workflowId: string; wpId: string; nextAttempt: number; eventId: string }>
  escalated: Array<{ workflowId: string; wpId: string; eventId: string }>
  /** 동시 sweep이 선점해 skip된 항목 수. */
  skipped: number
}

/** 한 항목 reclaim: 성공 시 outcome.reclaimed에 추가 + dispatch 신호(P4-1) 발행, skip이면 outcome.skipped++. */
async function reclaimOne(item: ReclaimItem, deps: SweepDeps, visibilityMs: number, now: number, outcome: SweepOutcome): Promise<void> {
  const r = await deps.store.recordReclaim({
    workflowId: item.workflowId, wpId: item.wpId, nextAttempt: item.nextAttempt, stepN: item.stepN, visibilityMs,
  })
  if (r.status !== 'reclaimed') { outcome.skipped += 1; return }
  if (deps.publish) await publishDispatchSignal(deps.publish, item.workflowId, item.wpId, item.nextAttempt, now)
  outcome.reclaimed.push({ workflowId: item.workflowId, wpId: item.wpId, nextAttempt: item.nextAttempt, eventId: r.eventId })
}

/** 그래프에서 projectId 조회 — 미주입·미존재·실패는 null(N3 never-throw: lease escalation 비차단). */
async function resolveProjectId(graphStore: GraphQueryPort | undefined, workflowId: string): Promise<string | null> {
  if (!graphStore) return null
  try {
    return (await graphStore.getGraph(workflowId))?.userContext?.projectId ?? null
  } catch (err) {
    console.warn('[lease-sweep] projectId 조회 실패(best-effort·null 강등):', err)
    return null
  }
}

/** 한 항목 escalate: 성공 시 outcome.escalated에 추가 + 결함 브리프(P6·best-effort), skip이면 outcome.skipped++. */
async function escalateOne(item: ReclaimItem, deps: SweepDeps, outcome: SweepOutcome): Promise<void> {
  const r = await deps.store.recordEscalation({
    workflowId: item.workflowId, wpId: item.wpId, attempt: item.attempt, stepN: item.stepN,
  })
  if (r.status !== 'escalated') { outcome.skipped += 1; return }
  if (deps.onEscalated) {
    const projectId = await resolveProjectId(deps.graphStore, item.workflowId)
    try {
      await deps.onEscalated({ workflowId: item.workflowId, wpId: item.wpId, attempt: item.attempt, stepN: item.stepN, projectId })
    } catch (err) {
      console.warn('[lease-sweep] 결함 브리프 생성 실패(best-effort·escalation 이벤트는 진실원천):', err)
    }
  }
  outcome.escalated.push({ workflowId: item.workflowId, wpId: item.wpId, eventId: r.eventId })
}

/**
 * lease 만료 sweep: expiredActiveLeases → planReclaim → 항목별 원자 recordReclaim/recordEscalation.
 * handleDispatch 대칭(조회·계획·원자 적재 분리). 타이머 구동은 LeaseSweeper가 담당(P1d-7 server.ts 배선).
 */
export async function handleLeaseSweep(now: number, deps: SweepDeps): Promise<SweepOutcome> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const visibilityMs = deps.visibilityMs ?? DEFAULT_VISIBILITY_MS
  const expired = await deps.store.expiredActiveLeases(now)
  const plan = planReclaim(expired, { maxAttempts })

  const outcome: SweepOutcome = { reclaimed: [], escalated: [], skipped: 0 }
  for (const item of plan) {
    if (item.action === 'reclaim') await reclaimOne(item, deps, visibilityMs, now, outcome)
    else await escalateOne(item, deps, outcome)
  }
  return outcome
}
