import { describe, it, expect } from 'vitest'
import { oracleSatisfiedSet, WorkPackageSchema } from '../index.js'
import type { ApprovedOracleView } from '../index.js'

const wp = (over: Partial<{ id: string; storyId: string; acceptanceCriteria: string[] }>) =>
  WorkPackageSchema.parse({ id: over.id ?? 'wp1', storyId: over.storyId ?? 's1', owningRole: 'dev', oracleRef: null, acceptanceCriteria: over.acceptanceCriteria ?? ['ac1'] })

const oracle = (storyId: string, covered: string[]): ApprovedOracleView => ({ storyId, coveredCriteria: new Set(covered) })

describe('oracleSatisfiedSet (§8 DoR)', () => {
  it('story 바인딩 approved 오라클이 모든 AC를 덮으면 satisfied', () => {
    const set = oracleSatisfiedSet([wp({ id: 'a', storyId: 's1', acceptanceCriteria: ['ac1', 'ac2'] })], [oracle('s1', ['ac1', 'ac2'])])
    expect(set.has('a')).toBe(true)
  })
  it('AC 하나라도 미커버면 미충족', () => {
    const set = oracleSatisfiedSet([wp({ id: 'a', storyId: 's1', acceptanceCriteria: ['ac1', 'ac2'] })], [oracle('s1', ['ac1'])])
    expect(set.has('a')).toBe(false)
  })
  it('story에 오라클 없으면 미충족', () => {
    const set = oracleSatisfiedSet([wp({ id: 'a', storyId: 's1' })], [oracle('s2', ['ac1'])])
    expect(set.has('a')).toBe(false)
  })
  it('빈 AC는 오라클 존재 시 vacuously satisfied, 없으면 미충족', () => {
    expect(oracleSatisfiedSet([wp({ id: 'a', storyId: 's1', acceptanceCriteria: [] })], [oracle('s1', [])]).has('a')).toBe(true)
    expect(oracleSatisfiedSet([wp({ id: 'b', storyId: 's9', acceptanceCriteria: [] })], [oracle('s1', [])]).has('b')).toBe(false)
  })
  it('입력 순서 무관(결정론)', () => {
    const wps = [wp({ id: 'a', storyId: 's1' }), wp({ id: 'b', storyId: 's2' })]
    const ora = [oracle('s2', ['ac1']), oracle('s1', ['ac1'])]
    expect([...oracleSatisfiedSet(wps, ora)].sort()).toEqual(['a', 'b'])
  })
})
