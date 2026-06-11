import { describe, it, expect } from 'vitest'
import {
  confidenceFromSupport,
  aggregateDimension,
  combineRisk,
  routeModels,
  evaluateHumanGate,
  scoreClassification,
  RiskClassificationSchema,
  RISK_DIMENSIONS,
  FULL_CONFIDENCE_SUPPORT,
} from '../risk/risk-classification.js'

describe('confidenceFromSupport', () => {
  it('support 0이면 0(증거 없음)', () => {
    expect(confidenceFromSupport(0)).toBe(0)
  })
  it('독립 소스가 많을수록 단조 증가하고 FULL에서 1로 포화', () => {
    expect(confidenceFromSupport(1)).toBeCloseTo(1 / FULL_CONFIDENCE_SUPPORT, 10)
    expect(confidenceFromSupport(FULL_CONFIDENCE_SUPPORT)).toBe(1)
    expect(confidenceFromSupport(FULL_CONFIDENCE_SUPPORT + 5)).toBe(1) // 상한 클램프
  })
  it('음수 support는 0으로 클램프', () => {
    expect(confidenceFromSupport(-2)).toBe(0)
  })
})

describe('aggregateDimension', () => {
  it('해당 차원 claim이 없으면 score·confidence 모두 0', () => {
    expect(aggregateDimension([], 'domain')).toEqual({ score: 0, confidence: 0 })
  })
  it('noisy-OR로 score를, 평균으로 confidence를 집계한다', () => {
    const claims = [
      { text: 'a', dimension: 'compliance' as const, support: 3, confidence: 1, citations: ['u1'] }, // c=1
      { text: 'b', dimension: 'compliance' as const, support: 0, confidence: 0, citations: [] },      // c=0
      { text: 'c', dimension: 'domain' as const, support: 3, confidence: 1, citations: ['u2'] },      // 다른 차원
    ]
    const r = aggregateDimension(claims, 'compliance')
    // noisy-OR(1, 0) = 1 - (1-1)(1-0) = 1
    expect(r.score).toBeCloseTo(1, 10)
    // 평균 confidence = (1 + 0) / 2 = 0.5
    expect(r.confidence).toBeCloseTo(0.5, 10)
  })
})

describe('combineRisk', () => {
  const ds = (score: number, confidence = 1) => ({ score, confidence })
  it('최대 차원 점수가 HIGH 임계 이상이면 HIGH', () => {
    expect(combineRisk({ domain: ds(0.9), complexity: ds(0.1), external_deps: ds(0), compliance: ds(0) })).toBe('HIGH')
  })
  it('중간 점수면 MEDIUM, 낮으면 LOW', () => {
    expect(combineRisk({ domain: ds(0.5), complexity: ds(0), external_deps: ds(0), compliance: ds(0) })).toBe('MEDIUM')
    expect(combineRisk({ domain: ds(0.1), complexity: ds(0), external_deps: ds(0), compliance: ds(0) })).toBe('LOW')
  })
  it('컴플라이언스 프레임워크 감지 시 최소 MEDIUM으로 바닥을 올린다', () => {
    expect(combineRisk(
      { domain: ds(0), complexity: ds(0), external_deps: ds(0), compliance: ds(0) },
      { complianceFrameworks: ['HIPAA'] },
    )).toBe('MEDIUM')
  })
})

describe('routeModels (§5)', () => {
  it('LOW면 PM만 opus, 나머지 4개는 sonnet', () => {
    expect(routeModels('LOW')).toEqual({ PM: 'opus', Developer: 'sonnet', Designer: 'sonnet', Tester: 'sonnet', Security: 'sonnet' })
  })
  it('HIGH면 전부 opus', () => {
    expect(routeModels('HIGH')).toEqual({ PM: 'opus', Developer: 'opus', Designer: 'opus', Tester: 'opus', Security: 'opus' })
  })
  it('MEDIUM은 기본 sonnet, 컴플라이언스 감지 시 Security를 opus로 에스컬레이션', () => {
    expect(routeModels('MEDIUM')).toEqual({ PM: 'opus', Developer: 'sonnet', Designer: 'sonnet', Tester: 'sonnet', Security: 'sonnet' })
    expect(routeModels('MEDIUM', { complianceDetected: true }).Security).toBe('opus')
  })
})

describe('evaluateHumanGate (§4)', () => {
  const full = { domain: { score: 0.1, confidence: 1 }, complexity: { score: 0.1, confidence: 1 }, external_deps: { score: 0.1, confidence: 1 }, compliance: { score: 0.1, confidence: 1 } }
  it('HIGH risk면 사람 게이트 필수', () => {
    expect(evaluateHumanGate('HIGH', full).required).toBe(true)
  })
  it('고stakes 차원(점수 높음)인데 confidence가 임계 미만이면 사람 게이트 필수', () => {
    const low = { ...full, complexity: { score: 0.6, confidence: 0.3 } } // 위험해 보이는데 불확실
    const g = evaluateHumanGate('MEDIUM', low)
    expect(g.required).toBe(true)
    expect(g.reason).toMatch(/confidence|complexity/i)
  })
  it('점수가 낮으면(위험 신호 없음) confidence가 낮아도 게이트 안 함(stakes 낮음)', () => {
    const low = { ...full, complexity: { score: 0.05, confidence: 0 } }
    expect(evaluateHumanGate('LOW', low).required).toBe(false)
  })
  it('전부 고신뢰·LOW면 사람 게이트 불필요', () => {
    expect(evaluateHumanGate('LOW', full).required).toBe(false)
  })
})

describe('scoreClassification (P4–P5 결정론 조립)', () => {
  it('verified claim에서 RiskClassification 아티팩트를 산출한다(스키마 통과)', () => {
    const result = scoreClassification({
      projectId: 'proj-1',
      claims: [
        { text: 'PHI 취급 → HIPAA 적용', dimension: 'compliance', support: 3, citations: ['hipaa.gov#164'] },
        { text: '분산 트랜잭션 필요', dimension: 'complexity', support: 2, citations: ['doc#tx'] },
      ],
      complianceFrameworks: ['HIPAA'],
    })
    expect(RiskClassificationSchema.safeParse(result).success).toBe(true)
    expect(result.projectId).toBe('proj-1')
    expect(result.classifierModel).toBe('opus') // Wiki Agent 자신은 항상 Opus
    expect(result.claims[0]!.confidence).toBeGreaterThan(0) // support→confidence 산정
    expect(RISK_DIMENSIONS.every((d) => d in result.dimensionScores)).toBe(true)
    // 컴플라이언스 프레임워크 → 최소 MEDIUM → Security 에스컬레이션
    expect(['MEDIUM', 'HIGH']).toContain(result.risk)
    expect(result.audit.version).toBe(1)
    expect(result.audit.approvedBy).toBeNull()
  })

  it('claim이 비면 LOW·사람게이트 불필요(증거 없음은 별개 — 빈 분류)', () => {
    const result = scoreClassification({ projectId: 'p', claims: [] })
    expect(result.risk).toBe('LOW')
    expect(result.dimensionScores.domain).toEqual({ score: 0, confidence: 0 })
    expect(result.humanGate.required).toBe(false) // 위험 신호 0 → 게이트 불필요

  })
})
