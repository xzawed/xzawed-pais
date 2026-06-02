export type GateMode = 'manual' | 'auto'

export interface GateConfig {
  defaultMode: GateMode
  overrides: Record<string, GateMode>
}

export const DEFAULT_GATE_CONFIG: GateConfig = { defaultMode: 'manual', overrides: {} }

/** 게이트 대상 = 에이전트 디스패치 도구. 보조 도구(register/switch/github_ops)는 제외. */
export const GATED_TOOLS: ReadonlySet<string> = new Set([
  'plan_task', 'design_ui', 'develop_code',
  'run_tests', 'build_project', 'watch_changes', 'security_audit',
])

/**
 * 배포 도구 — 되돌리기 어려운 외부 작업이라 **항상 manual** 승인(auto override 무시).
 * 비전의 'GitHub 배포 → ⛔ 승인' 게이트(A3).
 */
export const DEPLOY_TOOLS: ReadonlySet<string> = new Set(['deploy_project'])

export function isGatedTool(toolName: string): boolean {
  return GATED_TOOLS.has(toolName) || DEPLOY_TOOLS.has(toolName)
}

/**
 * 지식성 단계 = 도메인 지식을 산출하는 에이전트(planner·designer·developer·security).
 * 게이트 승인 시 '위키에 저장'은 이 단계에서만 의미가 있다(run_tests·build 등 일시 산출물 제외).
 */
export const KNOWLEDGE_BEARING_STAGES: ReadonlySet<string> = new Set([
  'plan_task', 'design_ui', 'develop_code', 'security_audit',
])

export function isKnowledgeBearingStage(stage: string): boolean {
  return KNOWLEDGE_BEARING_STAGES.has(stage)
}

export function effectiveMode(config: GateConfig, stage: string): GateMode {
  if (DEPLOY_TOOLS.has(stage)) return 'manual' // 배포는 항상 수동 승인
  return config.overrides[stage] ?? config.defaultMode
}

export type GateDecision =
  | { kind: 'approve'; rememberAuto: boolean; saveToWiki: boolean }
  | { kind: 'revise'; feedback: string }
  | { kind: 'abort' }

/**
 * info_response.answer(JSON)에서 승인 결정을 해석한다. 파싱 불가·미지 값은 approve로 fail-open.
 * approve에 `rememberAuto: true`면 해당 단계를 이후 자동 승인(override=auto)으로 전환한다.
 * approve에 `saveToWiki: true`면 승인된 결정 요약을 도메인 위키에 저장한다(누락 시 false).
 */
export function parseDecision(answer: string): GateDecision {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer)
  } catch {
    return { kind: 'approve', rememberAuto: false, saveToWiki: false }
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'approve', rememberAuto: false, saveToWiki: false }
  const obj = parsed as Record<string, unknown>
  const decision = obj['decision']
  if (decision === 'abort') return { kind: 'abort' }
  if (decision === 'revise') {
    const fb = obj['feedback']
    return { kind: 'revise', feedback: typeof fb === 'string' ? fb : '' }
  }
  return { kind: 'approve', rememberAuto: obj['rememberAuto'] === true, saveToWiki: obj['saveToWiki'] === true }
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
