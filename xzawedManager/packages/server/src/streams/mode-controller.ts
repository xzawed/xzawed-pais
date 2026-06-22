import { desiredMode, nextMode } from '@xzawed/agent-streams'
import type { OperationalMode, ModeSignals } from '@xzawed/agent-streams'
import { IntervalSweeper } from './interval-sweeper.js'

/** ModeController 의존: 신호 조회·안정 윈도·전이 콜백(관측). */
export interface ModeControllerDeps {
  signals: () => ModeSignals
  stabilityWindowMs: number
  /** 전이 시 호출(구조적 로그·M8). 미주입이면 무음 추적만(권장: 항상 주입). */
  onTransition?: (from: OperationalMode, to: OperationalMode, reason: string) => void
}

/**
 * P5-3a 운영 강등 모드 추적기(observe-only). IntervalSweeper 주기 tick으로 신호→모드 전이 산출,
 * 전이 시 onTransition(로그). enforcement 0 — getMode()만 노출(P5-3b 소비). never-throw(IntervalSweeper).
 * MANAGER_DEGRADED_MODE=false면 미생성(회귀 0).
 */
export class ModeController extends IntervalSweeper {
  private mode: OperationalMode = 'NORMAL'
  private recoveryEligibleAt: number | null = null

  constructor(
    private readonly deps: ModeControllerDeps,
    sweepMs: number,
    now: () => number = () => Date.now(),
  ) {
    super(sweepMs, now)
  }

  protected async tick(now: number): Promise<void> {
    const desired = desiredMode(this.deps.signals())
    const r = nextMode({
      current: this.mode,
      desired,
      now,
      recoveryEligibleAt: this.recoveryEligibleAt,
      stabilityWindowMs: this.deps.stabilityWindowMs,
    })
    this.recoveryEligibleAt = r.recoveryEligibleAt
    if (r.changed) {
      const from = this.mode
      this.mode = r.mode
      this.deps.onTransition?.(from, r.mode, r.reason)
    }
  }

  protected onError(err: unknown): void {
    console.warn('[mode-controller] tick 실패 — 다음 주기 재시도:', err)
  }

  /** 현재 운영 모드(observe-only·P5-3b 소비 예정). */
  getMode(): OperationalMode {
    return this.mode
  }
}
