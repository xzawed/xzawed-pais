import { describe, it, expect } from 'vitest'
import { ManagerToSecurityMessageSchema } from './types.js'

describe('ManagerToSecurityMessageSchema', () => {
  const base = {
    sessionId: 'sess-1',
    messageId: 'msg-1',
    timestamp: 1000,
    type: 'audit_request' as const,
    payload: {
      artifacts: ['src/index.ts'],
      projectPath: '/workspace/project',
      severity: 'high' as const,
      context: {},
    },
  }

  it('유효한 audit_request 메시지를 파싱한다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('abort 타입을 파싱한다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse({ ...base, type: 'abort' })
    expect(result.success).toBe(true)
  })

  it('severity low를 파싱한다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, severity: 'low' },
    })
    expect(result.success).toBe(true)
  })

  it('severity medium을 파싱한다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, severity: 'medium' },
    })
    expect(result.success).toBe(true)
  })

  it('빈 artifacts 배열을 파싱한다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, artifacts: [] },
    })
    expect(result.success).toBe(true)
  })

  it('절대경로 artifact는 파싱 실패한다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, artifacts: ['/absolute/path.ts'] },
    })
    expect(result.success).toBe(false)
  })

  it('경로 탐색(..) artifact는 파싱 실패한다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, artifacts: ['../outside/file.ts'] },
    })
    expect(result.success).toBe(false)
  })

  it('userContext 포함 메시지를 파싱한다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: {
        ...base.payload,
        userContext: { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace' },
      },
    })
    expect(result.success).toBe(true)
  })

  it('알 수 없는 severity는 파싱 실패한다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, severity: 'critical' },
    })
    expect(result.success).toBe(false)
  })
})
