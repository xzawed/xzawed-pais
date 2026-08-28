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

  it.each([
    ['../outside/file.ts', '앞선 상위 이동'],
    ['a/../../etc/passwd', '중간 상위 이동'],
    ['a/..', '끝의 상위 이동'],
  ])('경로 탐색 artifact 는 파싱 실패한다: %s (%s)', (p) => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, artifacts: [p] },
    })
    expect(result.success).toBe(false)
  })

  /**
   * **세그먼트 판정 회귀 가드.**
   *
   * 예전 술어는 `!s.includes('..')` 였다. 이 이름들이 전부 걸렸고, Zod `refine` 실패는
   * 항목 하나가 아니라 **메시지 전체**를 거부시켜 `security_audit` 이 DLQ→타임아웃이 됐다 —
   * 기본 대화형 챗 경로에서 감사 요청이 통째로 사라졌다.
   */
  it.each([
    ['patches/v1..v2.diff', '버전 범위 파일명'],
    ['src/..hidden.ts', '점 두 개로 시작하는 이름'],
    ['a..b/c.ts', '디렉토리명 안의 연속 점'],
    ['report..md', '확장자 앞 연속 점'],
    ['...', '점 세 개'],
  ])('탈출이 아닌 정상 파일명은 통과한다: %s (%s)', (p) => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, artifacts: [p] },
    })
    expect(result.success).toBe(true)
  })

  it('정상 파일명 하나가 메시지 전체를 죽이지 않는다', () => {
    const result = ManagerToSecurityMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, artifacts: ['patches/v1..v2.diff', 'src/app.ts'] },
    })
    expect(result.success).toBe(true)
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
