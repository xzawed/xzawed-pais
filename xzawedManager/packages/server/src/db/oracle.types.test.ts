import { describe, it, expect } from 'vitest'
import { OracleSchema, coveredCriteria } from './oracle.types.js'

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
