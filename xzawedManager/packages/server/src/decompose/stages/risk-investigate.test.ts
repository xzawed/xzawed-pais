import { describe, it, expect } from 'vitest'
import { verifyCitations, normalizeFrameworks, buildRiskInvestigationSpec, RiskInvestigationSchema } from './risk-investigate.js'

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
})

describe('buildRiskInvestigationSpec', () => {
  it('intent를 user 프롬프트에 담고 fallback은 빈 조사', () => {
    const spec = buildRiskInvestigationSpec('build a HIPAA portal')
    expect(spec.user).toContain('HIPAA portal')
    expect(spec.fallback()).toEqual({ claims: [], complianceFrameworks: [] })
    expect(RiskInvestigationSchema.safeParse(spec.fallback()).success).toBe(true)
  })
})
