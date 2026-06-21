/** 주기 폴링 sweeper 공유 베이스 — 타이머·재진입 가드·never-throw. LeaseSweeper/DecisionSweeper가 상속. */
export abstract class IntervalSweeper {
  private timer: ReturnType<typeof setInterval> | null = null
  private sweeping = false

  protected constructor(
    private readonly sweepMs: number,
    protected readonly now: () => number = () => Date.now(),
  ) {}

  /** 한 주기 작업(서브클래스 구현). 던지면 onError로 위임(타이머·다른 주기 보호). */
  protected abstract tick(now: number): Promise<void>
  /** tick 실패 시 경고(서브클래스가 라벨 제공). */
  protected abstract onError(err: unknown): void

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.pollOnce()
    }, this.sweepMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async pollOnce(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      await this.tick(this.now())
    } catch (err) {
      this.onError(err)
    } finally {
      this.sweeping = false
    }
  }
}
