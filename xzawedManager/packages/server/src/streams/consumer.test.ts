import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('./redis.client.js', () => ({
  getRedisClient: vi.fn(),
}))

import { getRedisClient } from '../streams/redis.client.js'
import { OrchestratorToManagerMessageSchema, StreamConsumer } from './consumer.js'

describe('OrchestratorToManagerMessageSchema — decompose_request', () => {
  it('유효한 decompose_request를 파싱', () => {
    const r = OrchestratorToManagerMessageSchema.safeParse({
      sessionId: 's', messageId: 'm', timestamp: 1, type: 'decompose_request', payload: { intent: 'build it' },
    })
    expect(r.success).toBe(true)
  })

  it('intent 빈 문자열은 거부', () => {
    const r = OrchestratorToManagerMessageSchema.safeParse({
      sessionId: 's', messageId: 'm', timestamp: 1, type: 'decompose_request', payload: { intent: '' },
    })
    expect(r.success).toBe(false)
  })

  it('userContext가 있으면 함께 파싱(P4a-2 additive)', () => {
    const r = OrchestratorToManagerMessageSchema.safeParse({
      sessionId: 's', messageId: 'm', timestamp: 1, type: 'decompose_request',
      payload: { intent: 'build it', userContext: { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/p1' } },
    })
    expect(r.success).toBe(true)
    if (r.success && r.data.type === 'decompose_request') {
      expect(r.data.payload.userContext?.workspaceRoot).toBe('/workspace/p1')
    }
  })

  it('불량 userContext(필수 필드 누락)는 거부', () => {
    const r = OrchestratorToManagerMessageSchema.safeParse({
      sessionId: 's', messageId: 'm', timestamp: 1, type: 'decompose_request',
      payload: { intent: 'build it', userContext: { userId: 'u1' } },
    })
    expect(r.success).toBe(false)
  })

  it('상대경로 workspaceRoot는 Zod 단계에서 거부(절대경로 강제 — false-success 방지)', () => {
    const r = OrchestratorToManagerMessageSchema.safeParse({
      sessionId: 's', messageId: 'm', timestamp: 1, type: 'decompose_request',
      payload: { intent: 'build it', userContext: { userId: 'u1', projectId: 'p1', workspaceRoot: 'projects/p1' } },
    })
    expect(r.success).toBe(false)
  })

  it('기존 task_request도 여전히 파싱(회귀 0)', () => {
    const r = OrchestratorToManagerMessageSchema.safeParse({
      sessionId: 's', messageId: 'm', timestamp: 1, type: 'task_request',
      payload: { intent: 'x', context: {}, priority: 'normal' },
    })
    expect(r.success).toBe(true)
  })
})

// ─── StreamConsumer 인바운드 DLQ 테스트 ───────────────────────────────────────

function makeRedis(xreadgroupResults: unknown[][] = []) {
  let callCount = 0
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockImplementation(() => {
      if (callCount >= xreadgroupResults.length) {
        return new Promise<null>(r => setImmediate(() => r(null)))
      }
      return Promise.resolve(xreadgroupResults[callCount++])
    }),
    xack: vi.fn().mockResolvedValue(1),
    xadd: vi.fn().mockResolvedValue('1-0'),
  }
}

afterEach(() => vi.clearAllMocks())

describe('StreamConsumer — 인바운드 DLQ 격리', () => {
  it('스키마 무효 메시지를 {stream}:dlq로 격리하고 ack한다(invalid_schema)', async () => {
    const sid = '550e8400-e29b-41d4-a716-446655440000'
    const stream = `orchestrator:to-manager:${sid}`
    const mockRedis = makeRedis([[[stream, [['9-0', ['data', JSON.stringify({ type: 'unknown_type' })]]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const handler = vi.fn()
    const c = new StreamConsumer('redis://localhost:6379')
    const p = c.start(sid, handler)
    await new Promise(r => setTimeout(r, 50)); c.stop(); await p
    expect(handler).not.toHaveBeenCalled()
    expect(mockRedis.xadd.mock.calls[0]![0]).toBe(`${stream}:dlq`)
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('핸들러 throw를 {stream}:dlq로 격리하고 ack한다(handler_failed·재시도 없음)', async () => {
    const sid = '550e8400-e29b-41d4-a716-446655440000'
    const stream = `orchestrator:to-manager:${sid}`
    const msg = { sessionId: sid, messageId: 'm1', timestamp: 1, type: 'abort', payload: {} }
    const mockRedis = makeRedis([[[stream, [['9-1', ['data', JSON.stringify(msg)]]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const handler = vi.fn().mockRejectedValue(new Error('boom'))
    const c = new StreamConsumer('redis://localhost:6379')
    const p = c.start(sid, handler)
    await new Promise(r => setTimeout(r, 50)); c.stop(); await p
    expect(handler).toHaveBeenCalledTimes(1)
    expect(mockRedis.xadd.mock.calls[0]![0]).toBe(`${stream}:dlq`)
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('data 필드 없는 구조적 결함은 DLQ 없이 ack-skip한다', async () => {
    const sid = '550e8400-e29b-41d4-a716-446655440000'
    const stream = `orchestrator:to-manager:${sid}`
    const mockRedis = makeRedis([[[stream, [['9-2', ['nodata', 'x']]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const c = new StreamConsumer('redis://localhost:6379')
    const p = c.start(sid, vi.fn())
    await new Promise(r => setTimeout(r, 50)); c.stop(); await p
    expect(mockRedis.xadd).not.toHaveBeenCalled()
    expect(mockRedis.xack).toHaveBeenCalled()
  })
})
