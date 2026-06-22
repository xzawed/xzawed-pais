/**
 * §13/OPERATIONS_DECISIONS §1 운영 강등 모드 FSM 순수 코어(I/O 0·주입형 clock).
 * 악화(severity↑)=즉시 desired 점프(장애 빠른 반영)·호전(severity↓)=stabilityWindow 경과 후 1단계씩(플래핑 방지).
 * enforcement(SAFE 디스패치 보류 등)는 소비자(P5-3b) 책임 — 여기는 모드 산출까지.
 */
export type OperationalMode = 'NORMAL' | 'DEGRADED' | 'SAFE'

/** 모드 산출 입력 신호(additive — 슬라이스1은 2개·후속 신호 필드 추가 여지). */
export interface ModeSignals {
  /** provider 서킷 open(지속 장애) → 최소 DEGRADED. */
  providerCircuitOpen?: boolean
  /** budget 일 상한 완전 트립 → SAFE(§1). */
  budgetDailyTripped?: boolean
}

const SEVERITY: Record<OperationalMode, number> = { NORMAL: 0, DEGRADED: 1, SAFE: 2 }

/** 신호 → 목표 모드(가장 심각한 활성 신호). 순수. */
export function desiredMode(s: ModeSignals): OperationalMode {
  if (s.budgetDailyTripped) return 'SAFE'
  if (s.providerCircuitOpen) return 'DEGRADED'
  return 'NORMAL'
}

export interface ModeTransitionInput {
  current: OperationalMode
  desired: OperationalMode
  now: number
  /** 복귀(하향) 대기 시작 시각. null=미대기. 악화·동급이면 무관(null로). controller가 보존·전달. */
  recoveryEligibleAt: number | null
  stabilityWindowMs: number
}
export interface ModeTransitionResult {
  mode: OperationalMode
  changed: boolean
  recoveryEligibleAt: number | null
  reason: string
}

function stepDown(m: OperationalMode): OperationalMode {
  return m === 'SAFE' ? 'DEGRADED' : 'NORMAL'
}

/** 1-tick 전이. 악화=즉시 점프·호전=히스테리시스(윈도 경과 후 1단계)·동급=무변. */
export function nextMode(input: ModeTransitionInput): ModeTransitionResult {
  const cur = SEVERITY[input.current]
  const des = SEVERITY[input.desired]
  if (des > cur) {
    return { mode: input.desired, changed: true, recoveryEligibleAt: null, reason: `escalate ${input.current}->${input.desired}` }
  }
  if (des === cur) {
    return { mode: input.current, changed: false, recoveryEligibleAt: null, reason: 'stable' }
  }
  // 호전(des < cur)
  if (input.recoveryEligibleAt === null) {
    return { mode: input.current, changed: false, recoveryEligibleAt: input.now + input.stabilityWindowMs, reason: `recovery pending (${input.stabilityWindowMs}ms window)` }
  }
  if (input.now >= input.recoveryEligibleAt) {
    const stepped = stepDown(input.current)
    const more = SEVERITY[stepped] > des
    return { mode: stepped, changed: true, recoveryEligibleAt: more ? input.now + input.stabilityWindowMs : null, reason: `recover ${input.current}->${stepped}` }
  }
  return { mode: input.current, changed: false, recoveryEligibleAt: input.recoveryEligibleAt, reason: 'recovery waiting' }
}
