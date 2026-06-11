import { z } from 'zod'
import { WpRiskSchema, type WpRisk } from '../types/work-package.js'

/**
 * P2-잔여 Wiki Agent 리스크 분류 — **결정론 코어**(spec §5·§20.2·WIKI_AGENT_RISK_CLASSIFICATION.md).
 *
 * 5단계 중 P4(투표 집계·confidence)·P5(차원 점수·종합·라우팅·사람 게이트)의 순수 코드 경계만 구현한다.
 * P2(조사)·P3(claim 추출)·인용 해소는 LLM/IO라 생산자(후속 슬라이스)가 담당하고, verified claim을 이 코어에
 * 넘겨 `scoreClassification`으로 RiskClassification 아티팩트를 조립한다. LLM·IO·부수효과 0.
 *
 * ⚠️ 산식·임계는 spec §19 캘리브레이션 대상(아래 상수). 라우팅 테이블은 §5 확정.
 */

/** 4개 리스크 차원(§1). */
export const RISK_DIMENSIONS = ['domain', 'complexity', 'external_deps', 'compliance'] as const
export type RiskDimension = (typeof RISK_DIMENSIONS)[number]

/** 라우팅 대상 5개 에이전트(출력 스키마 §3). Wiki Agent 자신은 분류기라 라우팅 대상이 아니다(항상 opus). */
export const ROUTED_AGENTS = ['PM', 'Developer', 'Designer', 'Tester', 'Security'] as const
export type RoutedAgent = (typeof ROUTED_AGENTS)[number]

/** 모델 티어(§5). Haiku는 복잡 검증 부적합으로 제외. 구체 model id는 배선 시 핀. */
export type ModelTier = 'opus' | 'sonnet'

// ── 캘리브레이션 상수(spec §19 확정 대상) ───────────────────────────────────────
/** 독립 소스 N개 이상이면 confidence 1로 포화. */
export const FULL_CONFIDENCE_SUPPORT = 3
/** 종합 risk 임계: 최대 차원 점수 기준. */
export const MEDIUM_SCORE_THRESHOLD = 0.34
export const HIGH_SCORE_THRESHOLD = 0.67
/** 사람 게이트: 위험 신호(점수)가 이 이상인데 confidence가 임계 미만이면 사람 확인. */
export const STAKES_SCORE_THRESHOLD = 0.34
export const LOW_CONFIDENCE_THRESHOLD = 0.7

/** P4: 독립 소스 수(support)→confidence. 일관될수록↑·FULL에서 포화·음수는 0(spec P4). */
export function confidenceFromSupport(support: number): number {
  if (support <= 0) return 0
  return Math.min(1, support / FULL_CONFIDENCE_SUPPORT)
}

/** 입력 claim(생산자가 추출·인용 검증 완료). confidence는 코어가 support에서 산정. */
export interface ClaimInput {
  text: string
  dimension: RiskDimension
  support: number
  citations: string[]
}

export const DimensionScoreSchema = z.object({
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
})
export type DimensionScore = z.infer<typeof DimensionScoreSchema>

export const ClaimSchema = z.object({
  text: z.string(),
  dimension: z.enum(RISK_DIMENSIONS),
  support: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  citations: z.array(z.string()).default([]),
})
export type Claim = z.infer<typeof ClaimSchema>

export const RiskClassificationSchema = z.object({
  projectId: z.string().min(1),
  risk: WpRiskSchema,
  dimensionScores: z.record(z.enum(RISK_DIMENSIONS), DimensionScoreSchema),
  complianceFrameworks: z.array(z.string()).default([]),
  claims: z.array(ClaimSchema).default([]),
  modelRouting: z.record(z.enum(ROUTED_AGENTS), z.enum(['opus', 'sonnet'])),
  humanGate: z.object({ required: z.boolean(), reason: z.string() }),
  classifierModel: z.literal('opus'), // Wiki Agent 자신은 항상 Opus(§4·§5)
  audit: z.object({
    approvedBy: z.string().nullable().default(null),
    approvedAt: z.string().nullable().default(null),
    version: z.number().int().positive().default(1),
  }),
})
export type RiskClassification = z.infer<typeof RiskClassificationSchema>

/** P5: 한 차원의 claim들을 noisy-OR(점수)·평균(confidence)으로 집계. claim 없으면 {0,0}. */
export function aggregateDimension(
  claims: ReadonlyArray<{ dimension: RiskDimension; confidence: number }>,
  dimension: RiskDimension,
): DimensionScore {
  const inDim = claims.filter((c) => c.dimension === dimension)
  if (inDim.length === 0) return { score: 0, confidence: 0 }
  // noisy-OR: 강한 위험 claim이 하나라도 있으면 점수↑(1 - ∏(1-c_i)). 0..1.
  const score = 1 - inDim.reduce((acc, c) => acc * (1 - c.confidence), 1)
  // 평균 confidence: 그 차원 판단을 얼마나 믿을 수 있는가.
  const confidence = inDim.reduce((acc, c) => acc + c.confidence, 0) / inDim.length
  return { score, confidence }
}

export interface CombineOptions {
  complianceFrameworks?: string[]
}

/** P5: 차원 점수 → 종합 risk(최대 점수 기준). 컴플라이언스 프레임워크 감지 시 최소 MEDIUM 바닥. */
export function combineRisk(
  dimensionScores: Record<RiskDimension, DimensionScore>,
  opts: CombineOptions = {},
): WpRisk {
  const maxScore = Math.max(...RISK_DIMENSIONS.map((d) => dimensionScores[d]?.score ?? 0))
  let risk: WpRisk = maxScore >= HIGH_SCORE_THRESHOLD ? 'HIGH' : maxScore >= MEDIUM_SCORE_THRESHOLD ? 'MEDIUM' : 'LOW'
  // 컴플라이언스는 고stakes — 프레임워크 감지 시 LOW로 두지 않는다(바닥 MEDIUM).
  if ((opts.complianceFrameworks?.length ?? 0) > 0 && risk === 'LOW') risk = 'MEDIUM'
  return risk
}

export interface RouteOptions {
  /** MEDIUM에서 Security를 opus로 에스컬레이션(컴플라이언스 등 고위험 항목 감지 시·§5). */
  complianceDetected?: boolean
}

/** §5 라우팅 테이블. PM은 risk 무관 기본 opus(라우팅성 결정). LOW=나머지 sonnet·HIGH=전부 opus·MEDIUM=sonnet+에스컬레이션. */
export function routeModels(risk: WpRisk, opts: RouteOptions = {}): Record<RoutedAgent, ModelTier> {
  if (risk === 'HIGH') {
    return { PM: 'opus', Developer: 'opus', Designer: 'opus', Tester: 'opus', Security: 'opus' }
  }
  const base: Record<RoutedAgent, ModelTier> = {
    PM: 'opus', // 기본 Opus(오류가 5개 에이전트로 전파되는 라우팅성 결정)
    Developer: 'sonnet',
    Designer: 'sonnet',
    Tester: 'sonnet',
    Security: 'sonnet',
  }
  // MEDIUM: 고위험 항목(컴플라이언스) 감지 시 Security를 opus로 에스컬레이션.
  if (risk === 'MEDIUM' && opts.complianceDetected) base.Security = 'opus'
  return base
}

/**
 * §4 사람 게이트. 라우팅이 5개 에이전트 전체를 좌우하므로 다음이면 사람 확인으로 승급:
 * (1) HIGH risk, (2) 고stakes 차원(점수↑)인데 confidence 임계 미만, (3) 컴플라이언스 감지됐는데 불확실(충돌 proxy).
 */
export function evaluateHumanGate(
  risk: WpRisk,
  dimensionScores: Record<RiskDimension, DimensionScore>,
  complianceFrameworks: string[] = [],
): { required: boolean; reason: string } {
  if (risk === 'HIGH') return { required: true, reason: 'HIGH risk — 라우팅 영향 큼, 사람 확인 필요' }
  for (const d of RISK_DIMENSIONS) {
    const s = dimensionScores[d]
    if (s && s.score >= STAKES_SCORE_THRESHOLD && s.confidence < LOW_CONFIDENCE_THRESHOLD) {
      return { required: true, reason: `low-confidence high-stakes dimension: ${d}` }
    }
  }
  if (complianceFrameworks.length > 0) {
    const cc = dimensionScores.compliance?.confidence ?? 0
    if (cc < LOW_CONFIDENCE_THRESHOLD) {
      return { required: true, reason: `compliance uncertainty: ${complianceFrameworks.join(', ')}` }
    }
  }
  return { required: false, reason: '' }
}

export interface ScoreInput {
  projectId: string
  /** 생산자가 추출·인용 검증 완료한 claim(confidence는 코어가 support에서 산정). */
  claims: ClaimInput[]
  /** 컴플라이언스 차원 조사에서 감지한 프레임워크(HIPAA 등). */
  complianceFrameworks?: string[]
}

/**
 * P4–P5 결정론 조립: claim별 confidence 산정 → 차원 집계 → 종합 risk → 모델 라우팅 → 사람 게이트 →
 * RiskClassification 아티팩트. 사람 미승인 상태(audit.version=1·approvedBy=null)로 반환.
 */
export function scoreClassification(input: ScoreInput): RiskClassification {
  const complianceFrameworks = input.complianceFrameworks ?? []
  const claims: Claim[] = input.claims.map((c) => ({
    text: c.text,
    dimension: c.dimension,
    support: c.support,
    confidence: confidenceFromSupport(c.support),
    citations: c.citations,
  }))

  const dimensionScores = Object.fromEntries(
    RISK_DIMENSIONS.map((d) => [d, aggregateDimension(claims, d)]),
  ) as Record<RiskDimension, DimensionScore>

  const risk = combineRisk(dimensionScores, { complianceFrameworks })
  const modelRouting = routeModels(risk, { complianceDetected: complianceFrameworks.length > 0 })
  const humanGate = evaluateHumanGate(risk, dimensionScores, complianceFrameworks)

  return {
    projectId: input.projectId,
    risk,
    dimensionScores,
    complianceFrameworks,
    claims,
    modelRouting,
    humanGate,
    classifierModel: 'opus',
    audit: { approvedBy: null, approvedAt: null, version: 1 },
  }
}
