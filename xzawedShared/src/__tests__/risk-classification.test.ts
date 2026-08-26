import { describe, it, expect } from 'vitest'
import {
  confidenceFromSupport,
  aggregateDimension,
  combineRisk,
  routeModels,
  evaluateHumanGate,
  scoreClassification,
  scoreWpRisks,
  RiskClassificationSchema,
  RISK_DIMENSIONS,
  FULL_CONFIDENCE_SUPPORT,
} from '../risk/risk-classification.js'
import type { RiskDimension } from '../risk/risk-classification.js'

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

/**
 * **WP 별 등급**(결함 F2 · `S5.3b`).
 *
 * write-back 이 프로젝트 종합 등급 하나를 전 WP 에 균일하게 찍는 한 `wp.risk` 는 WP 판정이 아니라
 * 프로젝트 최댓값의 사본이다. 그것을 읽는 mutation θ_risk 게이트와 DEGRADED 서명 게이트는
 * 판단하는 척만 하고, per-tier θ(`S5.4`)는 전 WP 가 같은 등급이라 단일 θ 로 퇴화한다.
 */
describe('scoreWpRisks — WP 별 등급', () => {
  const claim = (dimension: RiskDimension, confidence: number, wpIds: string[] = []) =>
    ({ text: 't', dimension, support: 3, confidence, citations: ['c'], wpIds })

  /** 핵심 정의: 지목되지 않은 claim 은 전 WP 공통이다. 그래서 판단이 없으면 회귀가 0이다. */
  it('지목 없는 claim 은 전 WP 에 걸린다(회귀 0·fail-closed)', () => {
    const out = scoreWpRisks([claim('compliance', 1)], ['a', 'b', 'c'])
    expect(out).toEqual({ a: 'HIGH', b: 'HIGH', c: 'HIGH' })
  })

  /** 이것이 슬라이스의 값이다 — 좁히는 것은 분류기의 적극적 행위다. */
  it('지목된 WP 만 그 위험을 받는다', () => {
    const out = scoreWpRisks([claim('compliance', 1, ['a'])], ['a', 'b'])
    expect(out.a).toBe('HIGH')
    expect(out.b, '지목 안 된 WP 가 프로젝트 최댓값을 물려받았다(F2)').toBe('LOW')
  })

  /** 증거가 적어서 더 안전해지는 역설이 없어야 한다. */
  it('공통 claim 과 지목 claim 이 함께 걸린다', () => {
    const out = scoreWpRisks([claim('complexity', 0.5), claim('compliance', 1, ['a'])], ['a', 'b'])
    expect(out.a, '공통+지목 둘 다 받아야 한다').toBe('HIGH')
    expect(out.b, '공통만 받아 MEDIUM').toBe('MEDIUM')
  })

  /**
   * 프로젝트 채점과 같은 임계를 쓴다 — WP 용 상수를 따로 두면 캘리브레이션이 갈린다.
   * confidence 를 `confidenceFromSupport` 로 만들어 두 경로에 **같은 입력**을 준다
   * (support 2 → 2/3 ≈ 0.667 로 HIGH 임계 0.67 바로 아래 — 경계라 임계가 갈리면 값이 달라진다).
   */
  it('프로젝트 종합과 같은 임계·산식을 쓴다', () => {
    const support = 2
    const input = { text: 't', dimension: 'domain' as RiskDimension, support, citations: ['c'], wpIds: ['a'] }
    const project = scoreClassification({ projectId: 'p', claims: [input] })
    const wp = scoreWpRisks([{ ...input, confidence: confidenceFromSupport(support) }], ['a'])
    expect(wp.a).toBe(project.risk)
    expect(project.risk, '경계값이 아니면 이 테스트는 임계 차이를 못 잡는다').toBe('MEDIUM')
  })

  /** 컴플라이언스 바닥은 프로젝트 판정이므로 WP 에도 그대로 건다(fail-closed). */
  it('컴플라이언스 프레임워크 감지 시 WP 도 LOW 로 두지 않는다', () => {
    const out = scoreWpRisks([claim('domain', 0.1, ['a'])], ['a', 'b'], { complianceFrameworks: ['HIPAA'] })
    expect(out.b).toBe('MEDIUM')
  })

  it('WP 목록이 비면 빈 맵이다(모른다 ≠ 전부 프로젝트 등급)', () => {
    expect(scoreWpRisks([claim('domain', 1)], [])).toEqual({})
  })

  it('claim 이 없으면 전 WP LOW 다', () => {
    expect(scoreWpRisks([], ['a', 'b'])).toEqual({ a: 'LOW', b: 'LOW' })
  })

  /**
   * **없는 id 만 적힌 지목은 지목이 없는 것이다.** "해당 WP 없음"으로 읽으면 그 위험 신호가
   * 증발해 전 WP 가 실제보다 낮아진다 — 게이트가 풀리는 방향이라 가장 위험하다.
   * 생산자도 같은 정리를 하지만 그 불변식은 **코어에서** 성립해야 한다(먼 호출자에만 걸면
   * tsc 가 못 보고 새 호출자가 깬다). Grok 반증이 잡은 자리다.
   */
  it('아무 WP 도 못 맞히는 지목은 전 WP 공통으로 본다(증발 금지)', () => {
    const out = scoreWpRisks([claim('compliance', 1, ['없는-WP'])], ['a', 'b'])
    expect(out, '위험 신호가 증발해 전 WP 가 LOW 로 떨어졌다').toEqual({ a: 'HIGH', b: 'HIGH' })
  })

  it('일부만 맞히면 맞힌 WP 만 받는다', () => {
    const out = scoreWpRisks([claim('compliance', 1, ['a', '없는-WP'])], ['a', 'b'])
    expect(out).toEqual({ a: 'HIGH', b: 'LOW' })
  })
})

describe('scoreClassification — wpRisks 연결', () => {
  const c = { text: 't', dimension: 'compliance' as RiskDimension, support: 3, citations: ['x'] }

  it('workPackageIds 를 주면 wpRisks 를 채운다', () => {
    const out = scoreClassification({ projectId: 'p', claims: [{ ...c, wpIds: ['a'] }], workPackageIds: ['a', 'b'] })
    expect(out.wpRisks).toEqual({ a: 'HIGH', b: 'LOW' })
  })

  /** 모른다는 것을 "전부 프로젝트 등급"으로 바꾸면 그게 F2 다. */
  it('workPackageIds 가 없으면 wpRisks 는 빈 맵이다', () => {
    const out = scoreClassification({ projectId: 'p', claims: [{ ...c, wpIds: [] }] })
    expect(out.wpRisks).toEqual({})
    expect(out.risk, '프로젝트 종합은 그대로 나온다').toBe('HIGH')
  })

  it('wpIds 없는 구형 ClaimInput 도 받는다(전 WP 공통)', () => {
    const out = scoreClassification({ projectId: 'p', claims: [c], workPackageIds: ['a'] })
    expect(out.wpRisks).toEqual({ a: 'HIGH' })
    expect(out.claims[0]!.wpIds).toEqual([])
  })

  it('아티팩트가 스키마를 통과한다', () => {
    const out = scoreClassification({ projectId: 'p', claims: [{ ...c, wpIds: ['a'] }], workPackageIds: ['a'] })
    expect(RiskClassificationSchema.safeParse(out).success).toBe(true)
  })

  /** 과거 아티팩트에는 이 키가 없다 — 기본값이 "판정 없음"을 준다. */
  it('wpRisks 없는 구 아티팩트는 빈 맵으로 파싱된다', () => {
    const out = scoreClassification({ projectId: 'p', claims: [c], workPackageIds: ['a'] })
    const { wpRisks: _drop, ...legacy } = out
    expect(RiskClassificationSchema.parse(legacy).wpRisks).toEqual({})
  })
})
