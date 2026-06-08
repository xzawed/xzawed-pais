import type { ZodType } from 'zod'
import { callClaudeText, stripJsonFences } from '@xzawed/agent-streams'
import type { ClaudeLike } from '@xzawed/agent-streams'

/** 단계 LLM 호출에 필요한 주입 의존(테스트 mock 용이). */
export interface StageDeps {
  claude: ClaudeLike
  model: string
  timeoutMs: number
}

/** 한 단계의 프롬프트·스키마·degrade 명세. 응답은 래핑 오브젝트 가정. */
export interface StageSpec<T> {
  system: string
  user: string
  maxTokens: number
  schema: ZodType<T>
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

/**
 * 단계 1회 실행: callClaudeText → JSON 추출 → safeParse. 어떤 실패(throw·파싱·검증)든 spec.fallback().
 * 4단계가 이 함수만 호출해 call+parse+degrade 보일러플레이트를 1곳으로 모은다(CPD 회피).
 */
export async function runStage<T>(deps: StageDeps, spec: StageSpec<T>): Promise<T> {
  try {
    const text = await callClaudeText(deps.claude, deps.model, spec.maxTokens, spec.system, spec.user, deps.timeoutMs)
    const raw = extractJson(text)
    if (raw === undefined) return spec.fallback()
    const parsed = spec.schema.safeParse(raw)
    return parsed.success ? parsed.data : spec.fallback()
  } catch {
    return spec.fallback()
  }
}
