import { describe, it, expect } from 'vitest'
import { ManagerToDeveloperMessageSchema } from './types.js'

describe('ManagerToDeveloperMessageSchema', () => {
  const base = {
    sessionId: '00000000-0000-0000-0000-000000000001',
    messageId: 'msg-1',
    timestamp: 1000,
    type: 'develop_request' as const,
    payload: {
      plan: 'Add feature',
      projectPath: '/workspace/project',
      context: {},
    },
  }

  it('유효한 develop_request 메시지를 파싱한다', () => {
    const result = ManagerToDeveloperMessageSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('abort 타입을 파싱한다', () => {
    const result = ManagerToDeveloperMessageSchema.safeParse({ ...base, type: 'abort' })
    expect(result.success).toBe(true)
  })

  it('userContext 포함 메시지를 파싱한다', () => {
    const result = ManagerToDeveloperMessageSchema.safeParse({
      ...base,
      payload: {
        ...base.payload,
        userContext: { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace' },
      },
    })
    expect(result.success).toBe(true)
  })

  it('githubRepo 포함 userContext를 파싱한다', () => {
    const result = ManagerToDeveloperMessageSchema.safeParse({
      ...base,
      payload: {
        ...base.payload,
        userContext: {
          userId: 'u1',
          projectId: 'p1',
          workspaceRoot: '/workspace',
          githubRepo: { owner: 'org', repo: 'repo', branch: 'main' },
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it('필수 필드(context) 누락 시 파싱 실패한다', () => {
    // plan/projectPath는 query 모드 지원으로 optional이 됨. context는 여전히 필수.
    const { context: _context, ...withoutContext } = base.payload
    const result = ManagerToDeveloperMessageSchema.safeParse({
      ...base,
      payload: withoutContext,
    })
    expect(result.success).toBe(false)
  })

  it('알 수 없는 type은 파싱 실패한다', () => {
    const result = ManagerToDeveloperMessageSchema.safeParse({ ...base, type: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('timestamp가 숫자가 아니면 파싱 실패한다', () => {
    const result = ManagerToDeveloperMessageSchema.safeParse({ ...base, timestamp: 'now' })
    expect(result.success).toBe(false)
  })
})
