/**
 * §13 Budget 서킷브레이커 — 토큰 비용 누적 상한(워크플로/일)을 강제하는 순수 인메모리 코어.
 *
 * 병렬 subagent·Deep Research(P2 Wiki Agent·P4 적대검증)의 비용 폭발을 막는 횡단 보호.
 * `check`는 호출 전 fail-closed 선검사(상한 초과면 throw), `record`는 호출 후 비용 누적.
 * 호출 비용은 사전 미상이므로 **누적 ≥ 상한 시 다음 check가 차단**한다(임계를 넘긴 호출은 완료·이후 차단).
 *
 * 트립은 senario OPERATIONS_DECISIONS §1의 DEGRADED→SAFE 강등 신호의 입력 — 여기는 stop(throw)까지,
 * 상태머신 전이는 P6. I/O·DB·부수효과 0(주입형 clock으로 일 롤오버만).
 */

/** 모델별 단가(USD per 1M tokens). 출처: claude-api 레퍼런스(cached 2026-06-04). */
export interface ModelPrice {
  inputPerMtok: number
  outputPerMtok: number
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-fable-5': { inputPerMtok: 10, outputPerMtok: 50 },
  'claude-opus-4-8': { inputPerMtok: 5, outputPerMtok: 25 },
  'claude-opus-4-7': { inputPerMtok: 5, outputPerMtok: 25 },
  'claude-opus-4-6': { inputPerMtok: 5, outputPerMtok: 25 },
  'claude-sonnet-4-6': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-haiku-4-5': { inputPerMtok: 1, outputPerMtok: 5 },
}

/** 미지 모델은 Opus-tier로 보수적 과대추정(상한을 일찍 트립 = fail-closed 방향). */
const DEFAULT_PRICE: ModelPrice = { inputPerMtok: 5, outputPerMtok: 25 }

/**
 * Anthropic usage의 최소 구조. 전부 선택 + `null` 허용 — Anthropic.Usage(캐시 필드 `number | null`)를
 * 구조적으로 수용하고, `?? 0`이 null/undefined를 함께 0으로 처리(캐시 미사용 경로 안전).
 */
export interface TokenUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/** usage를 USD 비용으로 환산. 캐시 쓰기 1.25×·읽기 0.1× 가중(input 단가 적용). */
export function costOf(model: string, usage: TokenUsage): number {
  const price = MODEL_PRICING[model] ?? DEFAULT_PRICE
  const inputEquivalent =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * 0.1
  const output = usage.output_tokens ?? 0
  return (inputEquivalent * price.inputPerMtok + output * price.outputPerMtok) / 1_000_000
}

export interface BudgetCircuitOptions {
  /** 워크플로당 USD 상한. 0/미지정이면 비활성(Infinity). */
  perWorkflowUsd?: number
  /** 일(UTC) 전체 USD 상한. 0/미지정이면 비활성(Infinity). */
  dailyUsd?: number
  /** 주입형 clock(ms epoch). 기본 Date.now — 일 롤오버 결정론 테스트용. */
  now?: () => number
}

export interface BudgetRecordResult {
  workflowUsd: number
  dailyUsd: number
  tripped: boolean
}

export interface BudgetSnapshot {
  workflowUsd: number
  dailyUsd: number
  day: string
  tripped: boolean
}

export type BudgetScope = 'workflow' | 'daily'

/** 상한 초과 시 던지는 오류 — 호출자(러너)가 catch해 요청자에 error 발행(M8 stop·무음 금지). */
export class BudgetExceededError extends Error {
  constructor(
    readonly scope: BudgetScope,
    readonly workflowId: string,
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(`budget circuit tripped (${scope}): workflow=${workflowId} spent=$${spentUsd.toFixed(4)} cap=$${capUsd.toFixed(2)}`)
    this.name = 'BudgetExceededError'
  }
}

/** 양의 상한이면 그 값, 아니면 Infinity(비활성). */
function capOf(v: number | undefined): number {
  return v !== undefined && v > 0 ? v : Infinity
}

export class BudgetCircuitBreaker {
  private readonly perWorkflowUsd: number
  private readonly dailyUsd: number
  private readonly now: () => number
  private readonly workflowSpend = new Map<string, number>()
  private dayKey: string
  private daySpend = 0

  constructor(opts: BudgetCircuitOptions = {}) {
    this.perWorkflowUsd = capOf(opts.perWorkflowUsd)
    this.dailyUsd = capOf(opts.dailyUsd)
    this.now = opts.now ?? (() => Date.now())
    this.dayKey = this.currentDay()
  }

  private currentDay(): string {
    return new Date(this.now()).toISOString().slice(0, 10) // UTC YYYY-MM-DD
  }

  private rolloverIfNeeded(): void {
    const today = this.currentDay()
    if (today !== this.dayKey) {
      this.dayKey = today
      this.daySpend = 0
    }
  }

  /** 호출 전 선검사 — 워크플로/일 누적이 상한 이상이면 BudgetExceededError throw(fail-closed). */
  check(workflowId: string): void {
    this.rolloverIfNeeded()
    const wf = this.workflowSpend.get(workflowId) ?? 0
    if (wf >= this.perWorkflowUsd) throw new BudgetExceededError('workflow', workflowId, wf, this.perWorkflowUsd)
    if (this.daySpend >= this.dailyUsd) throw new BudgetExceededError('daily', workflowId, this.daySpend, this.dailyUsd)
  }

  /** 호출 후 비용 누적. 트립 여부(다음 check가 막을지)를 반환. */
  record(workflowId: string, model: string, usage: TokenUsage): BudgetRecordResult {
    this.rolloverIfNeeded()
    const cost = costOf(model, usage)
    const workflowUsd = (this.workflowSpend.get(workflowId) ?? 0) + cost
    this.workflowSpend.set(workflowId, workflowUsd)
    this.daySpend += cost
    return {
      workflowUsd,
      dailyUsd: this.daySpend,
      tripped: workflowUsd >= this.perWorkflowUsd || this.daySpend >= this.dailyUsd,
    }
  }

  /** 현재 상태(관측·테스트용). */
  snapshot(workflowId: string): BudgetSnapshot {
    this.rolloverIfNeeded()
    const workflowUsd = this.workflowSpend.get(workflowId) ?? 0
    return {
      workflowUsd,
      dailyUsd: this.daySpend,
      day: this.dayKey,
      tripped: workflowUsd >= this.perWorkflowUsd || this.daySpend >= this.dailyUsd,
    }
  }
}
