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

  it('경로 탐색(..) trigger는 파싱 실패한다', () => {
    const result = ManagerToWatcherMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, triggers: ['../outside/*.ts'] },
    })
    expect(result.success).toBe(false)
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
