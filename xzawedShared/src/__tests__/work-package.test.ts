import { describe, it, expect } from 'vitest'
import { WorkPackageSchema } from '../types/work-package.js'

const valid = {
  id: 'wp-abc',
  storyId: 'st-1',
  owningRole: 'developer',
  oracleRef: null,
  acceptanceCriteria: ['로그인 폼이 렌더된다'],
  dependencies: [],
}

describe('WorkPackageSchema', () => {
  it('유효한 Work Package를 통과시킨다', () => {
    expect(WorkPackageSchema.safeParse(valid).success).toBe(true)
  })

  it('optional 필드에 기본값을 채운다(§7 additive 포함)', () => {
    const r = WorkPackageSchema.parse({ id: 'wp', storyId: 's', owningRole: 'pm', oracleRef: null })
    expect(r.acceptanceCriteria).toEqual([])
    expect(r.dependencies).toEqual([])
    expect(r.status).toBe('draft')
    // §7 additive 필드 기본값
    expect(r.epicId).toBeNull()
    expect(r.inputs).toEqual([])
    expect(r.outputs).toEqual([])
    expect(r.risk).toBe('MEDIUM')
    expect(r.attributionCounters).toEqual({ impl: 0, task: 0, plan: 0 })
  })

  it('필수 필드(id) 누락을 거부한다', () => {
    const { id: _id, ...noId } = valid
    expect(WorkPackageSchema.safeParse(noId).success).toBe(false)
  })

  it('알 수 없는 status를 거부한다', () => {
    expect(WorkPackageSchema.safeParse({ ...valid, status: 'nope' }).success).toBe(false)
  })

  it('owningRole은 임의 문자열을 허용한다(WP0 #3 미해결)', () => {
    expect(WorkPackageSchema.safeParse({ ...valid, owningRole: 'anything' }).success).toBe(true)
  })

  describe('§7 계약 필드', () => {
    it('risk는 LOW|MEDIUM|HIGH만 허용한다', () => {
      expect(WorkPackageSchema.safeParse({ ...valid, risk: 'HIGH' }).success).toBe(true)
      expect(WorkPackageSchema.safeParse({ ...valid, risk: 'CRITICAL' }).success).toBe(false)
    })

    it('epicId는 문자열 또는 null이다(기본 null)', () => {
      expect(WorkPackageSchema.parse({ ...valid, epicId: 'epic-1' }).epicId).toBe('epic-1')
      expect(WorkPackageSchema.parse({ ...valid, epicId: null }).epicId).toBeNull()
    })

    it('inputs/outputs는 문자열 배열이다', () => {
      const r = WorkPackageSchema.parse({ ...valid, inputs: ['schema-x'], outputs: ['artifact-y'] })
      expect(r.inputs).toEqual(['schema-x'])
      expect(r.outputs).toEqual(['artifact-y'])
    })

    it('attributionCounters는 고정 {impl,task,plan} 형태다(부분 입력 시 0으로 채움)', () => {
      const r = WorkPackageSchema.parse({ ...valid, attributionCounters: { impl: 2, task: 1 } })
      expect(r.attributionCounters).toEqual({ impl: 2, task: 1, plan: 0 })
    })

    it('attributionCounters의 미지 키는 무시한다(자유형 record 아님)', () => {
      const r = WorkPackageSchema.parse({ ...valid, attributionCounters: { developer: 9, impl: 3 } })
      expect(r.attributionCounters).toEqual({ impl: 3, task: 0, plan: 0 })
      expect((r.attributionCounters as Record<string, number>)['developer']).toBeUndefined()
    })

    it('레거시 영속 WP(§7 필드·attributionCounters:{} 부재/빈)도 기본값으로 파싱한다(backward-compat)', () => {
      const legacy = { ...valid, attributionCounters: {} }
      const r = WorkPackageSchema.parse(legacy)
      expect(r.attributionCounters).toEqual({ impl: 0, task: 0, plan: 0 })
      expect(r.risk).toBe('MEDIUM')
      expect(r.epicId).toBeNull()
    })
  })
})
