import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveWorkspaceRoot } from '../security.js'

afterEach(() => vi.unstubAllEnvs())

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

  it('모든 소스 없으면 Error throw', () => {
    vi.stubEnv('WORKSPACE_ROOT', '')
    expect(() => resolveWorkspaceRoot(undefined, undefined)).toThrow('workspaceRoot를 결정할 수 없습니다')
  })
})
