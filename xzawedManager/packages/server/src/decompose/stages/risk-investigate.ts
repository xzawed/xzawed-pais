import { z } from 'zod'
import { RISK_DIMENSIONS } from '@xzawed/agent-streams'
import type { ClaimInput } from '@xzawed/agent-streams'
import type { StageSpec } from './run-stage.js'

export const MAX_CLAIMS_PER_DIMENSION = 8
export const MAX_FRAMEWORKS = 8
const INVESTIGATE_MAX_TOKENS = 2048

export const RiskInvestigationSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string(),
        dimension: z.enum(RISK_DIMENSIONS),
        support: z.number(),
        citations: z.array(z.string()).default([]),
        /** 이 위험 신호가 걸리는 WP id(결함 F2 · `S5.3b`). 비면 전 WP 공통. */
        wpIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  complianceFrameworks: z.array(z.string()).default([]),
})

/** LLM 조사 출력(원시). support는 검증에서 인용 수로 클램프된다. */
export type RiskInvestigation = z.infer<typeof RiskInvestigationSchema>
export type RawRiskClaim = RiskInvestigation['claims'][number]

const SYSTEM = [
  '당신은 프로젝트 리스크 분류기다. 프로젝트 설명을 4개 차원으로 평가한다:',
  'domain(도메인 난이도)·complexity(구현 복잡도)·external_deps(외부 의존)·compliance(규제·컴플라이언스).',
  '각 위험 신호를 claim으로 제시하되 **반드시 근거 인용(citations)을 동반**하라 — 설명 텍스트의 구절이나',
  '알려진 표준명(예: HIPAA, PCI-DSS). 인용 없는 추정은 제출하지 마라(폐기된다).',
  'support는 그 claim을 뒷받침하는 독립 근거의 수다(인용 수를 넘을 수 없다).',
  'compliance 프레임워크를 감지하면 complianceFrameworks에 나열하라.',
  'Work Package 목록이 주어지면 **각 claim이 실제로 걸리는 WP id를 wpIds에 지목하라.**',
  'wpIds를 비우면 그 위험이 **모든 WP에 걸린다**는 뜻이다 — 확신이 없을 때만 비워라.',
  '지목은 등급을 낮추는 유일한 수단이므로, 걸리지 않는 WP를 넣지 마라. 목록에 없는 id는 폐기된다.',
  '오직 JSON만 반환: {"claims":[{"text","dimension","support","citations":[],"wpIds":[]}],"complianceFrameworks":[]}',
].join(' ')

/** 프롬프트에 실을 WP 요약 — id 와 담당 역할만. 본문 전체를 넣으면 조사 토큰을 잠식한다. */
export interface RiskWpHint {
  id: string
  owningRole: string
}

/** 프롬프트에 나열할 WP 상한 — 초과분은 지목 대상에서 빠져 전 WP 공통 claim 만 받는다(보수적). */
export const MAX_WP_HINTS = 40

/**
 * 조사 스테이지 스펙(단일 LLM 호출·접근법 A). fallback은 빈 조사 → 생산자가 upsert skip.
 *
 * **WP 목록은 선택이다.** 없으면 예전 그대로 프로젝트만 조사하고 `wpIds` 는 전부 비어 전 WP
 * 공통이 된다 — 회귀 0. 있으면 claim 별 지목을 요구해 WP 판정을 만든다(결함 F2 · `S5.3b`).
 */
export function buildRiskInvestigationSpec(
  intent: string, workPackages: ReadonlyArray<RiskWpHint> = [],
): StageSpec<RiskInvestigation> {
  const hints = workPackages.slice(0, MAX_WP_HINTS)
  const wpBlock = hints.length > 0
    ? `\n\nWork Package 목록(id · 담당 역할):\n${hints.map((w) => `- ${w.id} · ${w.owningRole}`).join('\n')}`
    : ''
  return {
    system: SYSTEM,
    user: `프로젝트 설명:\n${intent}${wpBlock}\n\n위 지침대로 JSON으로 답하라.`,
    maxTokens: INVESTIGATE_MAX_TOKENS,
    schema: RiskInvestigationSchema,
    fallback: () => ({ claims: [], complianceFrameworks: [] }),
  }
}

function dedupeTrim(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const t = v.trim()
    if (t.length === 0 || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * 인용 해소 검증(순수·결정론): 무인용 폐기 · support=clamp(0, min(trunc(support), citations.length)) ·
 * citation trim/dedupe · support 0이면 폐기(신호 없음) · 차원당 MAX_CLAIMS_PER_DIMENSION 절단.
 * confidence는 코어(confidenceFromSupport)가 클램프된 support로 산정한다.
 *
 * **`wpIds` 는 실존 id 만 남긴다**(결함 F2 · `S5.3b`). LLM 이 없는 id 를 지어내면 그 지목은
 * 아무 WP 에도 안 걸려 위험 신호가 **증발**한다 — 폐기가 아니라 조용한 하향이라 더 나쁘다.
 *
 * **전부 환각이면 지목을 버리고 전 WP 공통으로 되돌린다.** 지목은 등급을 낮추는 유일한 수단이므로
 * 믿을 수 없는 지목은 넓히는 쪽(보수적)으로 처리한다 — 좁히는 쪽으로 잘못 가면 게이트가 풀린다.
 * `known` 을 주지 않으면 검증하지 않는다(WP 없이 도는 기존 경로 · 회귀 0).
 */
export function verifyCitations(
  raw: ReadonlyArray<RawRiskClaim>, known?: ReadonlySet<string>,
): ClaimInput[] {
  const out: ClaimInput[] = []
  const perDim = new Map<RawRiskClaim['dimension'], number>()
  for (const c of raw) {
    const citations = dedupeTrim(c.citations)
    if (citations.length === 0) continue
    const support = Math.max(0, Math.min(Math.trunc(c.support), citations.length))
    if (support === 0) continue
    const count = perDim.get(c.dimension) ?? 0
    if (count >= MAX_CLAIMS_PER_DIMENSION) continue
    perDim.set(c.dimension, count + 1)
    // `?? []` 는 방어다 — 스키마를 거치면 항상 배열이지만, 여기서 throw 하면 조사 전체가 날아가
    // 분류가 통째로 skip 된다(best-effort 라 조용히). 한 필드 부재가 그 대가를 치를 이유는 없다.
    const raws = dedupeTrim(c.wpIds ?? [])
    // known 미제공 → 검증 없음. 제공됐고 지목이 전부 환각이면 [](전 WP 공통)로 넓힌다.
    const wpIds = known === undefined ? raws : raws.filter((id) => known.has(id))
    out.push({ text: c.text, dimension: c.dimension, support, citations, wpIds })
  }
  return out
}

/** compliance 프레임워크 정규화(trim·dedupe·빈값 제거·cap). */
export function normalizeFrameworks(raw: ReadonlyArray<string>): string[] {
  return dedupeTrim(raw).slice(0, MAX_FRAMEWORKS)
}
