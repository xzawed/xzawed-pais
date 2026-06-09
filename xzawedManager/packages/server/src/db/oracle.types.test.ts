import { describe, it, expect } from 'vitest'
import { OracleSchema, coveredCriteria, OracleScenarioSchema, OracleDraftSchema, oracleIdFor } from './oracle.types.js'

describe('OracleSchema', () => {
  it('기본값을 적용해 파싱한다', () => {
    const o = OracleSchema.parse({ oracleId: 'o1', workflowId: 'wf1', storyId: 's1' })
    expect(o.status).toBe('pending')
    expect(o.version).toBe(1)
    expect(o.scenarios).toEqual([])
    expect(o.coverage).toEqual({})
  })
})

describe('coveredCriteria', () => {
  it('human_approved 시나리오가 덮는 AC만 포함', () => {
    const scenarios = [{ id: 'sc1', title: '', status: 'human_approved' as const }, { id: 'sc2', title: '', status: 'drafted' as const }]
    const coverage = { ac1: ['sc1'], ac2: ['sc2'], ac3: ['sc1', 'sc2'] }
    const set = coveredCriteria(scenarios, coverage)
    expect([...set].sort()).toEqual(['ac1', 'ac3']) // ac2는 drafted만이라 제외
  })
})

describe('P3-2 스키마', () => {
  it('OracleScenario given/when/then 기본값(P3-1 회귀 0)', () => {
    expect(OracleScenarioSchema.parse({ id: 'sc1' })).toMatchObject({ id: 'sc1', status: 'drafted', given: [], when: '', then: [] })
  })
  it('OracleDraftSchema는 oracleId 없이 storyId·scenarios·coverage', () => {
    const d = OracleDraftSchema.parse({ storyId: 's1', scenarios: [{ id: 's1-sc1' }], coverage: { ac1: ['s1-sc1'] } })
    expect(d).toMatchObject({ storyId: 's1', coverage: { ac1: ['s1-sc1'] } })
    expect(d.scenarios[0]?.status).toBe('drafted')
    expect('oracleId' in d).toBe(false)
  })
  it('oracleIdFor는 oracle- 접두 결정론 해시(동일 입력=동일 id)', () => {
    expect(oracleIdFor('wf1', 's1')).toBe(oracleIdFor('wf1', 's1'))
    expect(oracleIdFor('wf1', 's1')).toMatch(/^oracle-[0-9a-f]{32}$/)
  })
  it('oracleIdFor는 경계 모호성 충돌을 회피(길이-prefix 구분)', () => {
    // 단순 연결이면 ('a-b','c')와 ('a','b-c')가 'a-b-c'로 충돌 — 길이-prefix가 분리
    expect(oracleIdFor('a-b', 'c')).not.toBe(oracleIdFor('a', 'b-c'))
  })
})
