import { describe, it, expect } from 'vitest'
import { buildTaskGraph } from '@xzawed/agent-streams'
import { toWorkPackages, type LlmWorkPackage } from './map.js'

function llm(over: Partial<LlmWorkPackage> = {}): LlmWorkPackage {
  return { ref: 'r1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['ac'], dependsOn: [], ...over }
}

describe('toWorkPackages', () => {
  it('각 WP에 content-hash id(wp_ 접두)를 부여', () => {
    const out = toWorkPackages([llm()])
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toMatch(/^wp_[0-9a-f]{32}$/)
    expect(out[0]?.oracleRef).toBeNull()
    expect(out[0]?.status).toBe('draft')
  })

  it('dependsOn(ref)을 content-hash id로 리맵', () => {
    const out = toWorkPackages([llm({ ref: 'a' }), llm({ ref: 'b', dependsOn: ['a'] })])
    expect(out[1]?.dependencies).toEqual([out[0]?.id])
  })

  it('미지 ref 의존은 드롭(dangling 방지)', () => {
    const out = toWorkPackages([llm({ ref: 'a', dependsOn: ['ghost'] })])
    expect(out[0]?.dependencies).toEqual([])
  })

  it('자기참조(같은 id로 해소되는 의존)는 드롭', () => {
    const out = toWorkPackages([llm({ ref: 'a', dependsOn: ['a'] })])
    expect(out[0]?.dependencies).toEqual([])
  })

  it('중복 ref는 첫 항목만 유지', () => {
    const out = toWorkPackages([llm({ ref: 'a', acceptanceCriteria: ['first'] }), llm({ ref: 'a', acceptanceCriteria: ['second'] })])
    expect(out).toHaveLength(1)
    expect(out[0]?.acceptanceCriteria).toEqual(['first'])
  })

  it('빈 입력이면 빈 배열', () => {
    expect(toWorkPackages([])).toEqual([])
  })

  it('출력은 buildTaskGraph가 수용(dangling 0)', () => {
    const out = toWorkPackages([llm({ ref: 'a' }), llm({ ref: 'b', storyId: 's2', dependsOn: ['a'] })])
    expect(() => buildTaskGraph(out)).not.toThrow()
  })
})
