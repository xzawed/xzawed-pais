import { describe, it, expect } from 'vitest'
import { resolveWorkspaceRoot } from '../developer.js'

describe('resolveWorkspaceRoot', () => {
  it('userContext.workspaceRoot를 우선 사용한다', () => {
    const result = resolveWorkspaceRoot(
      { userId: 'u1', projectId: 'p1', workspaceRoot: '/tmp/my-project' },
      '/workspace',
    )
    expect(result).toBe('/tmp/my-project')
  })

  it('userContext 없으면 fallback 사용', () => {
    const result = resolveWorkspaceRoot(undefined, '/workspace')
    expect(result).toBe('/workspace')
  })

  it('userContext.workspaceRoot가 비어있으면 fallback 사용', () => {
    const result = resolveWorkspaceRoot(
      { userId: 'u1', projectId: 'p1', workspaceRoot: '' },
      '/workspace',
    )
    expect(result).toBe('/workspace')
  })
})
