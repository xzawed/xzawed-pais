import { handleLeaseSweep, type SweepDeps } from './lease.js'
import type { LeaseStore } from '../db/lease.repo.js'
import type { Publish } from './decomposition-consumer.js'
import { IntervalSweeper } from './interval-sweeper.js'

export interface LeaseSweeperDeps {
  store: LeaseStore
  maxAttempts: number
  visibilityMs: number
  /** P4-1: reclaim 시 wp.dispatch_signal 발행(워커 재실행). createSupervisor가 taskWorker 시 주입. */
  publish?: Publish
  /** P6: escalate 시 결함 브리프(DecisionRequest) 생성. createSupervisor가 decisionBrief 시 주입. */
  onEscalated?: SweepDeps['onEscalated']
  /** C0/C1: escalate 결함 브리프에 projectId 부여. createSupervisor가 decisionBrief 시 repo 주입. */
  graphStore?: SweepDeps['graphStore']
}

/**
 * lease 만료 sweep 폴러 — setInterval로 주기마다 handleLeaseSweep(reclaim/escalate)을 돌린다(OutboxRelay 패턴).
 * 재진입 가드로 느린 sweep이 틱과 겹쳐도 동시 sweep을 막는다(단일 인스턴스 전제). never-throw.
 */
export class LeaseSweeper extends IntervalSweeper {
  constructor(
    private readonly deps: LeaseSweeperDeps,
    sweepMs = 30_000,
    now: () => number = () => Date.now(),
  ) {
    super(sweepMs, now)
  }
  protected async tick(now: number): Promise<void> {
    await handleLeaseSweep(now, {
      store: this.deps.store,
      maxAttempts: this.deps.maxAttempts,
      visibilityMs: this.deps.visibilityMs,
      ...(this.deps.publish && { publish: this.deps.publish }),
      ...(this.deps.onEscalated && { onEscalated: this.deps.onEscalated }),
      ...(this.deps.graphStore && { graphStore: this.deps.graphStore }),
    })
  }
  protected onError(err: unknown): void {
    console.warn('[lease-sweeper] sweep 실패 — 다음 주기 재시도:', err)
  }
}
