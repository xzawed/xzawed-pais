import { describe, it, expect } from 'vitest'
import { WorkPackageSchema } from '../types/work-package.js'

const valid = {
  id: 'wp-abc',
  storyId: 'st-1',
  owningRole: 'developer',
  oracleRef: null,
  acceptanceCriteria: ['로그인 폼이 렌더된다'],
  dependencies: [],
  attributionCounters: {},
}

describe('WorkPackageSchema', () => {
  it('유효한 Work Package를 통과시킨다', () => {
    expect(WorkPackageSchema.safeParse(valid).success).toBe(true)
  })

  it('optional 필드에 기본값을 채운다', () => {
    const r = WorkPackageSchema.parse({ id: 'wp', storyId: 's', owningRole: 'pm', oracleRef: null })
    expect(r.acceptanceCriteria).toEqual([])
    expect(r.dependencies).toEqual([])
    expect(r.attributionCounters).toEqual({})
    expect(r.status).toBe('draft')
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

  it('attributionCounters는 숫자 맵을 받는다', () => {
    const r = WorkPackageSchema.parse({ ...valid, attributionCounters: { developer: 2, tester: 1 } })
    expect(r.attributionCounters['developer']).toBe(2)
  })
})
