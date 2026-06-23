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

  it('payload.model을 보존한다 (D5 모델 라우팅 — collaborationPayloadFields 회귀 가드)', () => {
    // D5: Manager 워커가 resolveWpModel로 주입한 모델 id는 collaborationPayloadFields(shared)의
    // model?: z.string()로 수용·보존된다. develop_request payload가 `...collaborationPayloadFields`를
    // spread하지 않게 되면(또는 모델 필드가 빠지면) developer가 payload.model을 항상 undefined로 읽어
    // CLAUDE_MODEL로 폴백(HIGH→opus 무효)하므로, 합성 스키마 경계에서 model 보존을 고정한다.
    const result = ManagerToDeveloperMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, model: 'claude-opus-4-8' },
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.payload.model).toBe('claude-opus-4-8')
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
