import type { UISpec } from '../types/streams.js'

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
  | { kind: 'approve'; rememberAuto: boolean; saveToWiki: boolean; wikiSummary?: string }
  | { kind: 'revise'; feedback: string }
  | { kind: 'abort' }

const SUMMARY_MAX = 2000

/** 요약 텍스트를 위키 저장 상한(2000자)으로 자른다(초과 시 말미에 truncated 표시). */
function clampSummary(text: string): string {
  return text.length > SUMMARY_MAX ? text.slice(0, SUMMARY_MAX) + '...[truncated]' : text
}

/**
 * info_response.answer(JSON)에서 승인 결정을 해석한다. 파싱 불가·미지 값은 approve로 fail-open.
 * approve에 `rememberAuto: true`면 해당 단계를 이후 자동 승인(override=auto)으로 전환한다.
 * approve에 `saveToWiki: true`면 승인된 결정 요약을 도메인 위키에 저장한다(누락 시 false).
 * approve에 `wikiSummary`(비어있지 않은 문자열)가 있으면 PO가 저장 전 편집한 요약으로 채택한다
 * (누락·비문자열·공백뿐이면 생략 → runner가 자동 요약으로 폴백).
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
  const ws = obj['wikiSummary']
  const wikiSummary = typeof ws === 'string' && ws.trim() !== '' ? clampSummary(ws) : undefined
  return {
    kind: 'approve',
    rememberAuto: obj['rememberAuto'] === true,
    saveToWiki: obj['saveToWiki'] === true,
    ...(wikiSummary !== undefined ? { wikiSummary } : {}),
  }
}

/** 사용자가 승인 판단에 쓸 산출물 요약(텍스트). content 우선, 없으면 전체 직렬화(2000자 상한). */
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
  return clampSummary(text)
}

/**
 * design_ui 결과에서 승인 카드 데모용 UISpec을 구성한다.
 * design_ui가 아니거나·객체가 아니거나·표시할 내용(components·content)이 없으면 undefined(첨부 생략).
 */
export function buildDemoSpec(stage: string, result: unknown): UISpec | undefined {
  if (stage !== 'design_ui') return undefined
  if (typeof result !== 'object' || result === null) return undefined
  const r = result as Record<string, unknown>
  const rawSpec = typeof r['uiSpec'] === 'object' && r['uiSpec'] !== null ? (r['uiSpec'] as Record<string, unknown>) : {}
  const t = rawSpec['type']
  const type: UISpec['type'] = t === 'form' || t === 'progress_board' ? t : 'mockup_viewer'
  const components = Array.isArray(r['components']) && r['components'].length > 0 ? (r['components'] as UISpec['components']) : undefined
  const content =
    typeof r['content'] === 'string' && r['content'] !== ''
      ? (r['content'] as string)
      : typeof rawSpec['content'] === 'string' && rawSpec['content'] !== ''
        ? (rawSpec['content'] as string)
        : undefined
  const title = typeof rawSpec['title'] === 'string' ? (rawSpec['title'] as string) : undefined
  if (!components && !content) return undefined
  return { type, ...(title ? { title } : {}), ...(content ? { content } : {}), ...(components ? { components } : {}) }
}
