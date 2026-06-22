import type { ZodType, ZodTypeDef } from 'zod'
import { callClaudeText, callClaudeTextWithUsage, stripJsonFences } from '@xzawed/agent-streams'
import type { ClaudeLike, BudgetCircuitBreaker, ProviderCircuitBreaker } from '@xzawed/agent-streams'

/** 단계 LLM 호출에 필요한 주입 의존(테스트 mock 용이). */
export interface StageDeps {
  claude: ClaudeLike
  model: string
  timeoutMs: number
  /** G1: §13 서킷(budget/provider). 설정 시 runStage가 pre-gate+record. 미설정이면 기존 경로(회귀 0). */
  circuit?: StageCircuit
}

/** 한 단계의 프롬프트·스키마·degrade 명세. 응답은 래핑 오브젝트 가정. */
export interface StageSpec<T> {
  system: string
  user: string
  maxTokens: number
  schema: ZodType<T, ZodTypeDef, unknown>
  /** 파싱 불가·검증 실패·throw 시 반환(빈 emit 금지의 토대). */
  fallback: () => T
}

/** 텍스트에서 최외곽 { .. } 를 추출해 JSON.parse. 추출 불가·파싱 실패 시 undefined. (배열 루트 응답은 미지원) */
function extractJson(text: string): unknown {
  const cleaned = stripJsonFences(text)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return undefined
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/** P2r-3: risk 스테이지만 주입하는 §13 서킷 컨텍스트. 미전달이면 runStage는 기존 경로(회귀 0). */
export interface StageCircuit {
  workflowId: string
  budget?: BudgetCircuitBreaker
  provider?: ProviderCircuitBreaker
  isProviderFailure?: (err: unknown) => boolean
}

/**
 * 단계 1회 실행: callClaudeText → JSON 추출 → safeParse. 어떤 실패(throw·파싱·검증)든 spec.fallback().
 * 4단계가 이 함수만 호출해 call+parse+degrade 보일러플레이트를 1곳으로 모은다(CPD 회피).
 * circuit 전달 시: provider.before()+budget.check(wf) pre-gate → callClaudeTextWithUsage → onSuccess/record.
 * circuit 미전달이면 기존 callClaudeText 경로(바이트 동일·회귀 0).
 */
export async function runStage<T>(deps: StageDeps, spec: StageSpec<T>, circuit: StageCircuit | undefined = deps.circuit): Promise<T> {
  if (circuit) {
    try {
      circuit.provider?.before()
      circuit.budget?.check(circuit.workflowId)
    } catch {
      return spec.fallback() // circuit open / 예산 초과 → best-effort skip
    }
  }
  try {
    let text: string
    if (circuit) {
      const r = await callClaudeTextWithUsage(deps.claude, deps.model, spec.maxTokens, spec.system, spec.user, deps.timeoutMs)
      circuit.provider?.onSuccess()
      if (r.usage) circuit.budget?.record(circuit.workflowId, deps.model, r.usage)
      text = r.text
    } else {
      text = await callClaudeText(deps.claude, deps.model, spec.maxTokens, spec.system, spec.user, deps.timeoutMs)
    }
    const raw = extractJson(text)
    if (raw === undefined) return spec.fallback()
    const parsed = spec.schema.safeParse(raw)
    return parsed.success ? parsed.data : spec.fallback()
  } catch (err) {
    if (circuit?.isProviderFailure?.(err)) circuit.provider?.onFailure()
    return spec.fallback()
  }
}

/** G1: workflowId + breaker들로 StageCircuit 구성(없으면 undefined). risk/decompose/advisory 공유(DRY). */
export function buildStageCircuit(
  workflowId: string,
  breakers: { budget?: BudgetCircuitBreaker; provider?: ProviderCircuitBreaker; isProviderFailure?: (err: unknown) => boolean },
): StageCircuit | undefined {
  if (!breakers.budget && !breakers.provider) return undefined
  return {
    workflowId,
    ...(breakers.budget && { budget: breakers.budget }),
    ...(breakers.provider && { provider: breakers.provider }),
    ...(breakers.isProviderFailure && { isProviderFailure: breakers.isProviderFailure }),
  }
}
