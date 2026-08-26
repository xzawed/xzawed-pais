import { describe, it, expect } from 'vitest'
import { verifyCitations, normalizeFrameworks, buildRiskInvestigationSpec, RiskInvestigationSchema, MAX_WP_HINTS } from './risk-investigate.js'

describe('verifyCitations', () => {
  it('무인용 claim을 폐기한다', () => {
    const out = verifyCitations([{ text: 'a', dimension: 'domain', support: 3, citations: [] }])
    expect(out).toEqual([])
  })
  it('support를 citations 수로 클램프한다(인플레 차단)', () => {
    const out = verifyCitations([{ text: 'a', dimension: 'complexity', support: 9, citations: ['x'] }])
    expect(out).toHaveLength(1)
    expect(out[0]!.support).toBe(1)
  })
  it('citation을 trim·dedupe하고 그 수로 support를 다시 클램프한다', () => {
    const out = verifyCitations([{ text: 'a', dimension: 'domain', support: 5, citations: [' s ', 's', 't'] }])
    expect(out[0]!.citations).toEqual(['s', 't'])
    expect(out[0]!.support).toBe(2)
  })
  it('클램프 후 support가 0이면 폐기한다(신호 없음)', () => {
    const out = verifyCitations([{ text: 'a', dimension: 'domain', support: 0, citations: ['s'] }])
    expect(out).toEqual([])
  })
  it('음수·비정수 support를 방어한다', () => {
    const out = verifyCitations([{ text: 'a', dimension: 'domain', support: -2, citations: ['s'] }])
    expect(out).toEqual([])
    const out2 = verifyCitations([{ text: 'b', dimension: 'domain', support: 2.9, citations: ['s', 't', 'u'] }])
    expect(out2[0]!.support).toBe(2)
  })
  it('차원당 MAX_CLAIMS_PER_DIMENSION으로 절단한다', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `c${i}`, dimension: 'domain' as const, support: 1, citations: ['s'] }))
    expect(verifyCitations(many).length).toBe(8)
  })
  it('결정론 — 같은 입력은 같은 출력', () => {
    const input = [{ text: 'a', dimension: 'domain' as const, support: 1, citations: ['s'] }]
    expect(verifyCitations(input)).toEqual(verifyCitations(input))
  })
})

describe('normalizeFrameworks', () => {
  it('trim·dedupe·빈 문자열 제거·cap', () => {
    expect(normalizeFrameworks([' HIPAA ', 'HIPAA', '', 'GDPR'])).toEqual(['HIPAA', 'GDPR'])
  })
  it('MAX_FRAMEWORKS(8)로 절단한다', () => {
    const input = Array.from({ length: 10 }, (_, i) => `FW-${i}`)
    expect(normalizeFrameworks(input)).toHaveLength(8)
  })
})

describe('buildRiskInvestigationSpec', () => {
  it('intent를 user 프롬프트에 담고 fallback은 빈 조사', () => {
    const spec = buildRiskInvestigationSpec('build a HIPAA portal')
    expect(spec.user).toContain('HIPAA portal')
    expect(spec.fallback()).toEqual({ claims: [], complianceFrameworks: [] })
    expect(RiskInvestigationSchema.safeParse(spec.fallback()).success).toBe(true)
  })
})

/**
 * **claim → WP 지목**(결함 F2 · `S5.3b`).
 *
 * 지목은 WP 등급을 프로젝트 등급 아래로 낮추는 **유일한 수단**이다. 그래서 지목을 믿을 수 없을 때는
 * 항상 넓히는 쪽(전 WP 공통)으로 처리한다 — 좁히는 쪽으로 잘못 가면 mutation·서명 게이트가 풀린다.
 */
describe('verifyCitations — WP 지목', () => {
  const raw = (wpIds?: string[]) =>
    ([{ text: 't', dimension: 'domain' as const, support: 1, citations: ['c'], ...(wpIds && { wpIds }) }])

  it('실존 id 는 유지한다', () => {
    expect(verifyCitations(raw(['a', 'b']), new Set(['a', 'b']))[0]!.wpIds).toEqual(['a', 'b'])
  })

  /** 없는 id 만 지목되면 그 위험 신호는 아무 WP 에도 안 걸려 **증발**한다 — 조용한 하향이다. */
  it('전부 환각이면 전 WP 공통으로 되돌린다(증발 금지)', () => {
    expect(verifyCitations(raw(['ghost']), new Set(['a']))[0]!.wpIds).toEqual([])
  })

  it('일부만 환각이면 실존 id 만 남긴다', () => {
    expect(verifyCitations(raw(['a', 'ghost']), new Set(['a']))[0]!.wpIds).toEqual(['a'])
  })

  it('중복·공백 지목을 정규화한다', () => {
    expect(verifyCitations(raw([' a ', 'a', '']), new Set(['a']))[0]!.wpIds).toEqual(['a'])
  })

  /** WP 없이 도는 기존 경로 — 검증할 목록이 없으면 검증하지 않는다(회귀 0). */
  it('known 미제공이면 지목을 그대로 둔다', () => {
    expect(verifyCitations(raw(['x']))[0]!.wpIds).toEqual(['x'])
  })

  /** 한 필드 부재로 조사 전체가 날아가면 분류가 통째로 skip 된다(best-effort 라 조용히). */
  it('wpIds 가 없는 입력도 던지지 않는다', () => {
    expect(verifyCitations(raw())[0]!.wpIds).toEqual([])
  })
})

describe('buildRiskInvestigationSpec — WP 목록', () => {
  it('WP 를 주면 id·역할을 프롬프트에 싣는다', () => {
    const spec = buildRiskInvestigationSpec('intent', [{ id: 'wp-1', owningRole: 'Developer' }])
    expect(spec.user).toContain('wp-1 · Developer')
    expect(spec.system).toContain('wpIds')
  })

  /** WP 없이 도는 기존 경로는 프롬프트가 그대로여야 한다. */
  it('WP 가 없으면 목록 블록을 붙이지 않는다', () => {
    expect(buildRiskInvestigationSpec('intent').user).not.toContain('Work Package 목록')
  })

  /** 상한을 넘긴 WP 는 지목 대상이 아니다 — 생산자도 같은 상한으로 잘라 환각 판정을 맞춘다. */
  it('MAX_WP_HINTS 로 절단한다', () => {
    const many = Array.from({ length: MAX_WP_HINTS + 5 }, (_, i) => ({ id: `wp-${i}`, owningRole: 'Developer' }))
    const spec = buildRiskInvestigationSpec('intent', many)
    expect(spec.user).toContain(`wp-${MAX_WP_HINTS - 1} ·`)
    expect(spec.user).not.toContain(`wp-${MAX_WP_HINTS} ·`)
  })
})
