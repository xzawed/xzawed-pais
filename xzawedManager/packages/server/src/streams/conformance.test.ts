import { describe, it, expect } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { OracleScenario } from '../db/oracle.types.js'
import { CONFORMANCE_DIR, buildConformanceAuthorPlan, selectConformanceTestFiles } from './conformance.js'

const wp = { id: 'wp-7', storyId: 'story-1', owningRole: 'developer', acceptanceCriteria: ['AC-1'], oracleRef: null, dependsOn: [] } as unknown as WorkPackage
const scenarios: OracleScenario[] = [
  { id: 's1', title: '유효 토큰만 허용', given: ['발급된 토큰'], when: '재설정 요청', thenSteps: ['성공'], status: 'human_approved' },
]

describe('buildConformanceAuthorPlan', () => {
  it('includes every approved scenario and the no-modify instruction and the convention path', () => {
    const plan = buildConformanceAuthorPlan(wp, scenarios)
    expect(plan).toContain('s1')
    expect(plan).toContain('유효 토큰만 허용')
    expect(plan).toContain('발급된 토큰')
    expect(plan).toContain('재설정 요청')
    expect(plan).toContain('성공')
    expect(plan).toContain(`${CONFORMANCE_DIR}/wp-7`)
    expect(plan).toMatch(/구현 파일을 수정하지|do not modify/i)
  })

  it('clamps to 4000 chars', () => {
    const many: OracleScenario[] = Array.from({ length: 300 }, (_, i) => ({
      id: `s${i}`, title: 'x'.repeat(50), given: ['g'.repeat(50)], when: 'w', thenSteps: ['t'], status: 'human_approved',
    }))
    expect(buildConformanceAuthorPlan(wp, many).length).toBeLessThanOrEqual(4000)
  })
})

describe('selectConformanceTestFiles', () => {
  it('keeps only artifacts under the conformance dir for this wp (normalizing separators)', () => {
    const artifacts = [
      '.xzawed/conformance/wp-7.test.ts',
      '.xzawed\\conformance\\wp-7.spec.ts',
      'src/impl.ts',
      '.xzawed/conformance/wp-OTHER.test.ts',
    ]
    expect(selectConformanceTestFiles(artifacts, 'wp-7')).toEqual([
      '.xzawed/conformance/wp-7.test.ts',
      '.xzawed\\conformance\\wp-7.spec.ts',
    ])
  })

  it('returns empty when no conformance artifact present', () => {
    expect(selectConformanceTestFiles(['src/impl.ts'], 'wp-7')).toEqual([])
  })
})
