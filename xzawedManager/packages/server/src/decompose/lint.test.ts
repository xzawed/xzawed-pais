import { describe, it, expect } from 'vitest'
import { singleRoleStoryIds } from './lint.js'

describe('singleRoleStoryIds', () => {
  it('역할 1개인 story만 식별(사전순)', () => {
    const roles = new Map<string, string[]>([
      ['s2', ['developer']],
      ['s1', ['developer', 'tester']],
      ['s3', ['designer']],
    ])
    expect(singleRoleStoryIds(roles)).toEqual(['s2', 's3'])
  })

  it('빈 Map → 빈 배열', () => {
    expect(singleRoleStoryIds(new Map())).toEqual([])
  })

  it('모두 다역할 → 빈 배열', () => {
    expect(singleRoleStoryIds(new Map<string, string[]>([['s1', ['developer', 'tester']]]))).toEqual([])
  })
})
