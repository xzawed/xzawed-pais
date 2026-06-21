import { z } from 'zod'
import { RISK_DIMENSIONS } from '@xzawed/agent-streams'
import type { ClaimInput, RiskDimension } from '@xzawed/agent-streams'
import type { StageSpec } from './run-stage.js'

export const MAX_CLAIMS_PER_DIMENSION = 8
export const MAX_FRAMEWORKS = 8
const INVESTIGATE_MAX_TOKENS = 2048

export const RiskInvestigationSchema = z
  .object({
    claims: z
      .array(
        z.object({
          text: z.string(),
          dimension: z.enum(RISK_DIMENSIONS),
          support: z.number(),
          citations: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    complianceFrameworks: z.array(z.string()).optional(),
  })
  .transform((data) => ({
    claims: (data.claims ?? []).map((c) => ({ ...c, citations: c.citations ?? [] })),
    complianceFrameworks: data.complianceFrameworks ?? [],
  }))

export type RawRiskClaim = {
  text: string
  dimension: RiskDimension
  support: number
  citations: string[]
}

/** LLM 조사 출력(원시). support는 검증에서 인용 수로 클램프된다. */
export type RiskInvestigation = z.infer<typeof RiskInvestigationSchema>

const SYSTEM = [
  '당신은 프로젝트 리스크 분류기다. 프로젝트 설명을 4개 차원으로 평가한다:',
  'domain(도메인 난이도)·complexity(구현 복잡도)·external_deps(외부 의존)·compliance(규제·컴플라이언스).',
  '각 위험 신호를 claim으로 제시하되 **반드시 근거 인용(citations)을 동반**하라 — 설명 텍스트의 구절이나',
  '알려진 표준명(예: HIPAA, PCI-DSS). 인용 없는 추정은 제출하지 마라(폐기된다).',
  'support는 그 claim을 뒷받침하는 독립 근거의 수다(인용 수를 넘을 수 없다).',
  'compliance 프레임워크를 감지하면 complianceFrameworks에 나열하라.',
  '오직 JSON만 반환: {"claims":[{"text","dimension","support","citations":[]}],"complianceFrameworks":[]}',
].join(' ')

/** 조사 스테이지 스펙(단일 LLM 호출·접근법 A). fallback은 빈 조사 → 생산자가 upsert skip. */
export function buildRiskInvestigationSpec(intent: string): StageSpec<RiskInvestigation> {
  return {
    system: SYSTEM,
    user: `프로젝트 설명:\n${intent}\n\n위 지침대로 JSON으로 답하라.`,
    maxTokens: INVESTIGATE_MAX_TOKENS,
    schema: RiskInvestigationSchema as z.ZodType<RiskInvestigation>,
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
 */
export function verifyCitations(raw: ReadonlyArray<RawRiskClaim>): ClaimInput[] {
  const out: ClaimInput[] = []
  const perDim = new Map<RiskDimension, number>()
  for (const c of raw) {
    const citations = dedupeTrim(c.citations)
    if (citations.length === 0) continue
    const support = Math.max(0, Math.min(Math.trunc(c.support), citations.length))
    if (support === 0) continue
    const count = perDim.get(c.dimension) ?? 0
    if (count >= MAX_CLAIMS_PER_DIMENSION) continue
    perDim.set(c.dimension, count + 1)
    out.push({ text: c.text, dimension: c.dimension, support, citations })
  }
  return out
}

/** compliance 프레임워크 정규화(trim·dedupe·빈값 제거·cap). */
export function normalizeFrameworks(raw: ReadonlyArray<string>): string[] {
  return dedupeTrim(raw).slice(0, MAX_FRAMEWORKS)
}
