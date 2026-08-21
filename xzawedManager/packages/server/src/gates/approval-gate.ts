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
 * `github_ops`의 원격 쓰기 액션. 읽기(`listRepos`·`listBranches`)는 제외한다.
 *
 * 이 도구는 `deploy_project`와 같은 일을 한다 — `commitAndPush`는 `updateRef`로 브랜치를
 * 옮기고 `mergeBranch`는 `repos.merge`를 부르며 `createRepo`는 저장소를 만든다. 도구 이름이
 * 다르다는 이유로 게이트를 비켜가면 A3는 우회 가능한 게이트가 된다.
 */
export const GITHUB_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'createRepo', 'createBranch', 'commitAndPush', 'createPR', 'createIssue', 'mergeBranch',
])

/**
 * 실행 **전에** 승인받아야 하는 호출 — 되돌릴 수 없는 외부 쓰기.
 *
 * 사후 게이트는 통보이지 게이트가 아니다. 실행한 뒤에 물으면 abort를 눌러도 이미 원격에
 * 올라가 있고, revise를 고르면 같은 핸들러가 다시 실행돼 승인 없이 한 번 더 쓴다.
 *
 * `github_ops`는 도구 단위가 아니라 **액션 단위**로 판정한다 — 목록 조회까지 승인 카드를
 * 띄우면 게이트가 소음이 되고, 소음이 된 게이트는 사람이 무조건 승인하게 만든다.
 */
export function requiresPreExecutionApproval(toolName: string, input?: unknown): boolean {
  if (DEPLOY_TOOLS.has(toolName)) return true
  if (toolName !== 'github_ops') return false
  const action = (input as { action?: unknown } | undefined)?.action
  return typeof action === 'string' && GITHUB_WRITE_ACTIONS.has(action)
}

/** 실행 **후에** 산출물을 검토하는 도구 — 에이전트 디스패치 결과는 봐야 판단할 수 있다. */
export function requiresPostExecutionApproval(toolName: string): boolean {
  return GATED_TOOLS.has(toolName)
}

/** 실행 전 승인 카드에 실을 요약 — 결과가 아직 없으므로 무엇을 할 것인지를 적는다. */
export function summarizeWriteIntent(toolName: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  const s = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '?')

  if (toolName === 'github_ops') {
    const action = s('action')
    const target = `${s('owner')}/${s('repo') !== '?' ? s('repo') : s('repoName')}`
    const parts = [`동작: ${action}`, `대상: ${target}`]
    if (action === 'commitAndPush') {
      const n = Array.isArray(o['files']) ? (o['files'] as unknown[]).length : 0
      parts.push(`브랜치: ${s('branch')}`, `파일 ${n}개`, `커밋: ${s('message') !== '?' ? s('message') : s('title')}`)
    }
    if (action === 'mergeBranch') parts.push(`${s('head')} → ${s('base')}`)
    if (action === 'createBranch') parts.push(`${s('fromBranch')} → ${s('branch')}`)
    if (action === 'createPR') parts.push(`${s('head')} → ${s('base')}`, `제목: ${s('title')}`)
    if (action === 'createRepo') parts.push(o['private'] === true ? 'private' : 'public')
    return parts.join(' · ')
  }

  const parts = [
    `대상: ${s('owner')}/${s('repo')}@${s('branch')}`,
    `커밋: ${s('commitMessage')}`,
    `소스: ${s('projectPath')}`,
  ]
  if (o['createRepo'] === true) {
    parts.push(o['makePrivate'] === true ? '저장소 없으면 생성(private)' : '저장소 없으면 생성(public)')
  }
  return parts.join(' · ')
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
  // fail-safe: 응답이 파싱 불가·비객체·미지 decision일 때 자동 승인 대신 사람 재검토로 에스컬레이션한다.
  // senario M8(무음 통과 금지)·N1(불확실=실패) — 시스템 결함은 approve가 아니라 needs_human이어야 한다.
  | { kind: 'needs_human'; reason: string }

const SUMMARY_MAX = 2000

/** 요약 텍스트를 위키 저장 상한(2000자)으로 자른다(초과 시 말미에 truncated 표시). */
function clampSummary(text: string): string {
  return text.length > SUMMARY_MAX ? text.slice(0, SUMMARY_MAX) + '...[truncated]' : text
}

/**
 * 응답이 파싱 불가·비객체·미지 decision일 때의 폴백 결정.
 * failSafe(기본)면 자동 승인하지 않고 사람 재검토(needs_human)로 에스컬레이션한다.
 * failSafe=false면 레거시 fail-open(순수 approve)으로 복원한다 — 단, 과거 fail-open이 'decision 키 없는
 * 객체'에서 rememberAuto/saveToWiki/wikiSummary 같은 부가 플래그를 읽던 동작은 재현하지 않는다(더 보수적).
 */
function fallbackDecision(failSafe: boolean, reason: string): GateDecision {
  return failSafe
    ? { kind: 'needs_human', reason }
    : { kind: 'approve', rememberAuto: false, saveToWiki: false }
}

/** answer 객체에서 approve 결정을 구성한다(rememberAuto·saveToWiki·PO 편집 wikiSummary). */
function buildApprove(obj: Record<string, unknown>): GateDecision {
  const ws = obj['wikiSummary']
  const wikiSummary = typeof ws === 'string' && ws.trim() !== '' ? clampSummary(ws) : undefined
  return {
    kind: 'approve',
    rememberAuto: obj['rememberAuto'] === true,
    saveToWiki: obj['saveToWiki'] === true,
    ...(wikiSummary !== undefined ? { wikiSummary } : {}),
  }
}

/**
 * info_response.answer(JSON)에서 승인 결정을 해석한다.
 * 정상 결정(approve/revise/abort)은 그대로 해석하고, 파싱 불가·비객체·미지 decision 값은
 * `failSafe`(기본 true)면 needs_human(자동 승인 금지·사람 재검토)로, false면 레거시 approve(fail-open)로 처리한다.
 * approve에 `rememberAuto: true`면 해당 단계를 이후 자동 승인(override=auto)으로 전환한다.
 * approve에 `saveToWiki: true`면 승인된 결정 요약을 도메인 위키에 저장한다(누락 시 false).
 * approve에 `wikiSummary`(비어있지 않은 문자열)가 있으면 PO가 저장 전 편집한 요약으로 채택한다
 * (누락·비문자열·공백뿐이면 생략 → runner가 자동 요약으로 폴백).
 */
export function parseDecision(answer: string, failSafe = true): GateDecision {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer)
  } catch {
    return fallbackDecision(failSafe, 'approval response is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return fallbackDecision(failSafe, 'approval response is not an object')
  }
  const obj = parsed as Record<string, unknown>
  const decision = obj['decision']
  if (decision === 'abort') return { kind: 'abort' }
  if (decision === 'revise') {
    const fb = obj['feedback']
    return { kind: 'revise', feedback: typeof fb === 'string' ? fb : '' }
  }
  if (decision === 'approve') return buildApprove(obj)
  // 미지/누락 decision 값 — 시스템 결함으로 간주(자동 승인 금지)
  return fallbackDecision(failSafe, `unknown approval decision: ${String(decision)}`)
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
