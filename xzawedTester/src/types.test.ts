import { describe, it, expect } from 'vitest'
import { ManagerToTesterMessageSchema } from './types.js'

describe('ManagerToTesterMessageSchema', () => {
  const base = {
    sessionId: '00000000-0000-0000-0000-000000000001',
    messageId: 'msg-1',
    timestamp: 1000,
    type: 'test_request' as const,
    payload: {
      projectPath: '/workspace/project',
      context: {},
    },
  }

  it('유효한 test_request 메시지를 파싱한다', () => {
    const result = ManagerToTesterMessageSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('abort 타입을 파싱한다', () => {
    const result = ManagerToTesterMessageSchema.safeParse({ ...base, type: 'abort' })
    expect(result.success).toBe(true)
  })

  it('testCommand 포함 메시지를 파싱한다', () => {
    const result = ManagerToTesterMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, testCommand: 'pnpm test' },
    })
    expect(result.success).toBe(true)
  })

  it('testFiles 포함 메시지를 파싱한다', () => {
    const result = ManagerToTesterMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, testFiles: ['src/index.test.ts'] },
    })
    expect(result.success).toBe(true)
  })

  it('userContext 포함 메시지를 파싱한다', () => {
    const result = ManagerToTesterMessageSchema.safeParse({
      ...base,
      payload: {
        ...base.payload,
        userContext: { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace' },
      },
    })
    expect(result.success).toBe(true)
  })

  it('projectPath 누락 시 파싱 실패한다', () => {
    const { projectPath: _p, ...withoutPath } = base.payload
    const result = ManagerToTesterMessageSchema.safeParse({ ...base, payload: withoutPath })
    expect(result.success).toBe(false)
  })

  it('알 수 없는 type은 파싱 실패한다', () => {
    const result = ManagerToTesterMessageSchema.safeParse({ ...base, type: 'run_tests' })
    expect(result.success).toBe(false)
  })
})
