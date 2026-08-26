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

/**
 * 입력 claim(생산자가 추출·인용 검증 완료). confidence는 코어가 support에서 산정.
 *
 * `wpIds` 는 **이 위험 신호가 실제로 걸리는 Work Package** 다(결함 F2 · `S5.3b`).
 * **빈 배열은 "전 WP 공통"이지 "해당 없음"이 아니다** — 분류기가 좁히지 못했다는 뜻이고,
 * 그 경우 이 claim 은 모든 WP 에 걸린다. 즉 **좁히는 것은 분류기의 적극적 행위**이고,
 * 아무 판단도 없으면 WP 등급은 프로젝트 등급 그대로다(fail-closed).
 */
export interface ClaimInput {
  text: string
  dimension: RiskDimension
  support: number
  citations: string[]
  /** 이 claim 이 걸리는 WP id. 비면 전 WP 공통(좁히지 못함). */
  wpIds?: string[]
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
  /** 이 claim 이 걸리는 WP id. 비면 전 WP 공통 — 과거 아티팩트는 이 키가 없어 기본값이 그 의미를 준다. */
  wpIds: z.array(z.string()).default([]),
})
export type Claim = z.infer<typeof ClaimSchema>

export const RiskClassificationSchema = z.object({
  projectId: z.string().min(1),
  risk: WpRiskSchema,
  dimensionScores: z.record(z.enum(RISK_DIMENSIONS), DimensionScoreSchema),
  complianceFrameworks: z.array(z.string()).default([]),
  claims: z.array(ClaimSchema).default([]),
  modelRouting: z.record(z.enum(ROUTED_AGENTS), z.enum(['opus', 'sonnet'])),
  /**
   * WP id → 등급(결함 F2 · `S5.3b`). **`risk` 는 프로젝트 종합이고 이것이 WP 판정이다.**
   * 비면 WP 별 판정이 없다는 뜻이고, 그때 write-back 은 **아무것도 쓰지 않는다** —
   * 프로젝트 등급을 전 WP 에 찍는 것이 바로 F2 였다.
   */
  wpRisks: z.record(z.string(), WpRiskSchema).default({}),
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

/**
 * **WP 별 등급**(결함 F2 · `S5.3b`).
 *
 * 지금까지 write-back 은 프로젝트 종합 등급 하나를 전 WP 에 균일하게 찍었다. 그러면 `wp.risk` 는
 * WP 판정이 아니라 프로젝트 최댓값의 사본이고, 그것을 읽는 mutation θ_risk 게이트와 DEGRADED
 * 서명 게이트는 **판단하는 척만** 한다. per-tier θ(`S5.4`)도 전 WP 가 같은 등급이면 단일 θ 로
 * 퇴화한다 — 그래서 이것이 `S5.4` 의 선행이다.
 *
 * **한 WP 에 걸리는 claim = 전 WP 공통(`wpIds` 빈 것) + 그 WP 를 지목한 것.** 이 정의가 핵심이다:
 * 분류기가 아무 판단도 못 하면 모든 claim 이 공통이 되어 WP 등급 = 프로젝트 등급(회귀 0·fail-closed),
 * **프로젝트 등급보다 낮아지는 유일한 길은 분류기가 그 claim 을 다른 WP 로 좁힌 것**이다.
 * 증거가 적어서 안전해지는 역설이 생기지 않는다.
 *
 * 임계·산식은 프로젝트 채점과 **같은 것을 그대로 쓴다**(`aggregateDimension`·`combineRisk`) —
 * WP 용 상수를 따로 두면 캘리브레이션이 둘로 갈린다.
 */
export function scoreWpRisks(
  claims: ReadonlyArray<Claim>,
  workPackageIds: ReadonlyArray<string>,
  opts: CombineOptions = {},
): Record<string, WpRisk> {
  const known = new Set(workPackageIds)
  // **지목이 아무 WP 도 못 맞히면 지목이 없는 것으로 본다.** 없는 id 만 적힌 claim 을 "해당 WP
  // 없음"으로 읽으면 그 위험 신호가 **증발**해 전 WP 가 실제보다 낮아진다 — 게이트가 풀리는
  // 방향이라 가장 위험하다. 생산자도 같은 정리를 하지만(`verifyCitations`), 그 불변식은 **여기서**
  // 성립해야 한다. 먼 호출자에만 걸린 불변식은 tsc 가 못 보고 결국 새 호출자가 깬다(Grok 반증).
  const narrowed = claims.map((c) => {
    const named = c.wpIds.filter((id) => known.has(id))
    return { claim: c, named }
  })
  const out: Record<string, WpRisk> = {}
  for (const wpId of workPackageIds) {
    const applicable = narrowed
      .filter(({ named }) => named.length === 0 || named.includes(wpId))
      .map(({ claim }) => claim)
    const dimensionScores = Object.fromEntries(
      RISK_DIMENSIONS.map((d) => [d, aggregateDimension(applicable, d)]),
    ) as Record<RiskDimension, DimensionScore>
    out[wpId] = combineRisk(dimensionScores, opts)
  }
  return out
}

export interface ScoreInput {
  projectId: string
  /** 생산자가 추출·인용 검증 완료한 claim(confidence는 코어가 support에서 산정). */
  claims: ClaimInput[]
  /** 컴플라이언스 차원 조사에서 감지한 프레임워크(HIPAA 등). */
  complianceFrameworks?: string[]
  /**
   * 이 워크플로의 WP id(결함 F2 · `S5.3b`). 주면 `wpRisks` 를 채운다.
   * **안 주면 빈 채로 둔다** — 모른다는 뜻이고, write-back 이 아무것도 안 쓰는 것이 옳다.
   */
  workPackageIds?: string[]
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
    wpIds: c.wpIds ?? [],
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
    // WP 목록을 못 받았으면 빈 채로 둔다 — "모른다"와 "전부 프로젝트 등급"은 다르다(F2).
    wpRisks: scoreWpRisks(claims, input.workPackageIds ?? [], { complianceFrameworks }),
    humanGate,
    classifierModel: 'opus',
    audit: { approvedBy: null, approvedAt: null, version: 1 },
  }
}
