import { describe, it, expect } from 'vitest'
import { ManagerToWatcherMessageSchema } from './types.js'

describe('ManagerToWatcherMessageSchema', () => {
  const base = {
    sessionId: 'sess-1',
    messageId: 'msg-1',
    timestamp: 1000,
    type: 'watch_request' as const,
    payload: {
      projectPath: '/workspace/project',
      triggers: ['src/**/*.ts'],
      context: {},
    },
  }

  it('유효한 watch_request 메시지를 파싱한다', () => {
    const result = ManagerToWatcherMessageSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('stop_watch 타입을 파싱한다', () => {
    const result = ManagerToWatcherMessageSchema.safeParse({
      ...base, type: 'stop_watch',
      payload: { ...base.payload, triggers: [] },
    })
    expect(result.success).toBe(true)
  })

  it('abort 타입을 파싱한다', () => {
    const result = ManagerToWatcherMessageSchema.safeParse({
      ...base, type: 'abort',
      payload: { ...base.payload, triggers: [] },
    })
    expect(result.success).toBe(true)
  })

  it('debounceMs 포함 메시지를 파싱한다', () => {
    const result = ManagerToWatcherMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, debounceMs: 500 },
    })
    expect(result.success).toBe(true)
  })

  it('절대경로 trigger는 파싱 실패한다', () => {
    const result = ManagerToWatcherMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, triggers: ['/absolute/path/*.ts'] },
    })
    expect(result.success).toBe(false)
  })

  it.each([
    ['../outside/*.ts', '앞선 상위 이동'],
    ['a/../../etc/*', '중간 상위 이동'],
  ])('경로 탐색 trigger 는 파싱 실패한다: %s (%s)', (p) => {
    const result = ManagerToWatcherMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, triggers: [p] },
    })
    expect(result.success).toBe(false)
  })

  /** 세그먼트 판정 회귀 가드 — 예전 `!includes('..')` 는 이 glob 들을 오거부했다. */
  it.each([
    ['patches/v1..v2/*.diff', '버전 범위 디렉토리'],
    ['src/..hidden/**', '점 두 개로 시작하는 디렉토리'],
    ['**/*..bak', '연속 점이 든 확장자'],
  ])('탈출이 아닌 정상 glob 은 통과한다: %s (%s)', (p) => {
    const result = ManagerToWatcherMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, triggers: [p] },
    })
    expect(result.success).toBe(true)
  })

  it('빈 triggers 배열은 파싱 성공한다', () => {
    const result = ManagerToWatcherMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, triggers: [] },
    })
    expect(result.success).toBe(true)
  })

  it('알 수 없는 type은 파싱 실패한다', () => {
    const result = ManagerToWatcherMessageSchema.safeParse({ ...base, type: 'start_watch' })
    expect(result.success).toBe(false)
  })
})
