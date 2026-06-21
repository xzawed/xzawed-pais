import { IntervalSweeper } from './interval-sweeper.js'

/** B1: 결정 만료 sweep — DecisionRepo가 구조적으로 만족(SupervisorDeps.decisionStore 인터섹션 포함). */
export interface DecisionSweepStore {
  expiredPendingRequests(now: number, limit: number): Promise<string[]>
  expireRequest(id: string): Promise<{ eventId: string } | null>
}
export interface DecisionSweepDeps {
  store: DecisionSweepStore
  batchLimit?: number
}

const DEFAULT_BATCH_LIMIT = 100

/** 만료 PENDING을 조회해 항목별 expireRequest(PENDING→EXPIRED·decision.expired 발행). never-throw(외부 쿼리·항목별 try/catch). */
export async function handleDecisionSweep(now: number, deps: DecisionSweepDeps): Promise<{ expired: number; skipped: number }> {
  let ids: string[]
  try {
    ids = await deps.store.expiredPendingRequests(now, deps.batchLimit ?? DEFAULT_BATCH_LIMIT)
  } catch (err) {
    console.warn('[decision-sweeper] expiredPendingRequests 실패 — 빈 sweep:', err)
    return { expired: 0, skipped: 0 }
  }
  let expired = 0
  let skipped = 0
  for (const id of ids) {
    try {
      const r = await deps.store.expireRequest(id)
      if (r) expired++
      else skipped++ // 이미 비-PENDING(경합·중복 sweep) — PENDING-only 가드가 null 반환
    } catch (err) {
      console.warn(`[decision-sweeper] expireRequest(${id}) 실패 — skip:`, err)
      skipped++
    }
  }
  return { expired, skipped }
}

/**
 * 결정 만료 sweep 폴러 — setInterval로 주기마다 handleDecisionSweep을 돌린다(LeaseSweeper 패턴).
 * 재진입 가드로 느린 sweep이 틱과 겹쳐도 동시 sweep을 막는다(단일 인스턴스 전제). never-throw.
 */
export class DecisionSweeper extends IntervalSweeper {
  constructor(
    private readonly deps: DecisionSweepDeps,
    sweepMs = 60_000, // 결정 TTL은 시간 단위라 분 단위 sweep으로 충분(LeaseSweeper 30s와 의도적 차등)
    now: () => number = () => Date.now(),
  ) {
    super(sweepMs, now)
  }
  protected async tick(now: number): Promise<void> {
    await handleDecisionSweep(now, this.deps)
  }
  protected onError(err: unknown): void {
    console.warn('[decision-sweeper] sweep 실패 — 다음 주기 재시도:', err)
  }
}
