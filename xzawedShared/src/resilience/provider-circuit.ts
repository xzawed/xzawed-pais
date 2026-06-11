/**
 * §13 Provider 서킷브레이커 — provider(Anthropic API)의 지속 장애(429/5xx/529/timeout)에 대한
 * 고전적 circuit breaker(closed → open → half_open). 순수 상태머신(I/O 0·주입형 clock).
 *
 * 무엇이 "실패"인지(에러 분류)는 provider-specific이라 **호출자(Manager 러너)가 판정**해 `onFailure`/`onSuccess`를
 * 호출한다(이 코어는 provider-agnostic). open이면 `before`가 fail-fast로 throw해 연쇄 장애·낭비 호출을 차단한다.
 *
 * 트립(open)은 OPERATIONS_DECISIONS §1의 NORMAL→DEGRADED 강등 신호 입력 — 여기는 stop(throw)+상태까지,
 * 강등 모드 전이(Sonnet 폴백 등)는 P6.
 */

export type CircuitState = 'closed' | 'open' | 'half_open'

const DEFAULT_FAILURE_THRESHOLD = 5
const DEFAULT_COOLDOWN_MS = 30_000

export interface ProviderCircuitOptions {
  /** 연속 실패 임계(기본 5). 도달 시 open. */
  failureThreshold?: number
  /** open 유지 시간(ms·기본 30s). 경과 후 half_open으로 1회 probe 허용. */
  cooldownMs?: number
  /** 주입형 clock(ms epoch). 기본 Date.now — cooldown 결정론 테스트용. */
  now?: () => number
}

export interface ProviderCircuitSnapshot {
  state: CircuitState
  consecutiveFailures: number
  openedAt: number
}

/** open 상태에서 fail-fast로 던지는 오류 — 호출자가 catch해 요청자에 error 발행(stop·무음 금지). */
export class ProviderCircuitOpenError extends Error {
  constructor(
    readonly openedAt: number,
    readonly cooldownMs: number,
  ) {
    super(`provider circuit open (failing fast; cooldown ${cooldownMs}ms, opened at ${openedAt})`)
    this.name = 'ProviderCircuitOpenError'
  }
}

export class ProviderCircuitBreaker {
  private readonly failureThreshold: number
  private readonly cooldownMs: number
  private readonly now: () => number
  private state: CircuitState = 'closed'
  private consecutiveFailures = 0
  private openedAt = 0

  constructor(opts: ProviderCircuitOptions = {}) {
    this.failureThreshold =
      opts.failureThreshold !== undefined && opts.failureThreshold > 0
        ? opts.failureThreshold
        : DEFAULT_FAILURE_THRESHOLD
    this.cooldownMs =
      opts.cooldownMs !== undefined && opts.cooldownMs > 0 ? opts.cooldownMs : DEFAULT_COOLDOWN_MS
    this.now = opts.now ?? (() => Date.now())
  }

  /**
   * 호출 전 게이트. open이고 cooldown 미경과면 ProviderCircuitOpenError throw(fail-fast).
   * cooldown 경과면 half_open으로 전이해 1회 probe 허용(통과). closed/half_open은 통과.
   */
  before(): void {
    if (this.state !== 'open') return
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half_open' // probe 허용
      return
    }
    throw new ProviderCircuitOpenError(this.openedAt, this.cooldownMs)
  }

  /** provider 성공 — 회로를 닫고 연속 실패 카운터를 리셋. */
  onSuccess(): void {
    this.state = 'closed'
    this.consecutiveFailures = 0
  }

  /**
   * provider 실패(호출자가 429/5xx/529/timeout으로 판정한 경우만 호출).
   * half_open이면 probe 실패로 즉시 재open(임계 무관). closed면 카운트++ 후 임계 도달 시 open.
   * 반환=이 실패가 새로 open을 유발했는지(알림 트리거용).
   */
  onFailure(): boolean {
    if (this.state === 'half_open') {
      this.open()
      return true
    }
    this.consecutiveFailures++
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.open()
      return true
    }
    return false
  }

  private open(): void {
    this.state = 'open'
    this.openedAt = this.now()
    this.consecutiveFailures = 0
  }

  snapshot(): ProviderCircuitSnapshot {
    return { state: this.state, consecutiveFailures: this.consecutiveFailures, openedAt: this.openedAt }
  }
}
