export type GateMode = 'manual' | 'auto'

export interface GateConfig {
  defaultMode: GateMode
  overrides: Record<string, GateMode>
}

export const DEFAULT_GATE_CONFIG: GateConfig = { defaultMode: 'manual', overrides: {} }

/** 게이트 대상 = 에이전트 디스패치 도구. 보조/배포 도구는 제외. */
export const GATED_TOOLS: ReadonlySet<string> = new Set([
  'plan_task', 'design_ui', 'develop_code',
  'run_tests', 'build_project', 'watch_changes', 'security_audit',
])

export function isGatedTool(toolName: string): boolean {
  return GATED_TOOLS.has(toolName)
}

export function effectiveMode(config: GateConfig, stage: string): GateMode {
  return config.overrides[stage] ?? config.defaultMode
}

export type GateDecision =
  | { kind: 'approve' }
  | { kind: 'revise'; feedback: string }
  | { kind: 'abort' }

/** info_response.answer(JSON)에서 승인 결정을 해석한다. 파싱 불가·미지 값은 approve로 fail-open. */
export function parseDecision(answer: string): GateDecision {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer)
  } catch {
    return { kind: 'approve' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'approve' }
  const decision = (parsed as Record<string, unknown>)['decision']
  if (decision === 'approve') return { kind: 'approve' }
  if (decision === 'abort') return { kind: 'abort' }
  if (decision === 'revise') {
    const fb = (parsed as Record<string, unknown>)['feedback']
    return { kind: 'revise', feedback: typeof fb === 'string' ? fb : '' }
  }
  return { kind: 'approve' }
}

const SUMMARY_MAX = 2000

/** 사용자가 승인 판단에 쓸 산출물 요약(텍스트). content 우선, 없으면 전체 직렬화. 상세 렌더는 PR2. */
export function summarizeOutput(_stage: string, result: unknown): string {
  let text: string
  if (
    typeof result === 'object' && result !== null &&
    typeof (result as Record<string, unknown>)['content'] === 'string'
  ) {
    text = String((result as Record<string, unknown>)['content'])
  } else {
    text = JSON.stringify(result) ?? ''
  }
  return text.length > SUMMARY_MAX ? text.slice(0, SUMMARY_MAX) + '...[truncated]' : text
}
