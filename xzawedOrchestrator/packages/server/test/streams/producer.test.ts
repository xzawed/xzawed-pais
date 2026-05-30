import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { OrchestratorToManagerMessage } from '@xzawed/shared'

const mockXadd = vi.fn().mockResolvedValue('1234-0')
vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    xadd = mockXadd
    quit = vi.fn()
  }
}))

const VALID_SESSION_ID = '00000000-0000-4000-8000-000000000001'
const VALID_SESSION_ID_2 = '11111111-1111-4111-8111-111111111111'
const VALID_SESSION_ID_3 = '22222222-2222-4222-8222-222222222222'
const VALID_SESSION_ID_4 = '33333333-3333-4333-8333-333333333333'

// setTimeout을 즉시 실행하도록 교체해 테스트 속도 보장
const originalSetTimeout = globalThis.setTimeout
beforeEach(() => {
  mockXadd.mockClear()
  // @ts-expect-error — 테스트용 즉시 실행 setTimeout
  globalThis.setTimeout = (fn: () => void) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout> }
})
afterEach(() => {
  globalThis.setTimeout = originalSetTimeout
})

describe('StreamProducer', () => {
  it('publishes message to orchestrator:to-manager stream', async () => {
    mockXadd.mockResolvedValue('1234-0')
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: OrchestratorToManagerMessage = {
      sessionId: VALID_SESSION_ID_2,
      messageId: 'msg-1',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: '쇼핑몰 만들기', context: {}, priority: 'normal' },
    }

    const id = await producer.publish(msg)

    expect(id).toBeDefined()
    expect(mockXadd).toHaveBeenCalledTimes(1)
    expect(mockXadd).toHaveBeenCalledWith(
      `orchestrator:to-manager:${VALID_SESSION_ID_2}`,
      '*',
      'data',
      JSON.stringify(msg)
    )
  })

  it('throws on invalid sessionId format', async () => {
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')
    const msg: OrchestratorToManagerMessage = {
      sessionId: 'invalid:session:id',
      messageId: 'msg-bad',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: 'test', context: {}, priority: 'normal' },
    }
    await expect(producer.publish(msg)).rejects.toThrow('Invalid sessionId format')
  })

  it('retries on transient xadd failure and succeeds on second attempt', async () => {
    mockXadd
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('5678-0')
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: OrchestratorToManagerMessage = {
      sessionId: VALID_SESSION_ID_3,
      messageId: 'msg-retry',
      timestamp: 2000,
      type: 'task_request',
      payload: { intent: '재시도 테스트', context: {}, priority: 'normal' },
    }

    const id = await producer.publish(msg)

    expect(id).toBe('5678-0')
    expect(mockXadd).toHaveBeenCalledTimes(2)
  })

  it('throws after all retries are exhausted', async () => {
    mockXadd.mockRejectedValue(new Error('Redis connection lost'))
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: OrchestratorToManagerMessage = {
      sessionId: VALID_SESSION_ID_4,
      messageId: 'msg-fail',
      timestamp: 3000,
      type: 'task_request',
      payload: { intent: '실패 테스트', context: {}, priority: 'normal' },
    }

    await expect(producer.publish(msg)).rejects.toThrow('Redis connection lost')
    // 최초 1회 + 재시도 3회 = 총 4회
    expect(mockXadd).toHaveBeenCalledTimes(4)
  })

  it('throws when xadd returns null (stream at MAXLEN) after all retries', async () => {
    mockXadd.mockResolvedValue(null)
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')
    const msg: OrchestratorToManagerMessage = {
      sessionId: VALID_SESSION_ID,
      messageId: 'msg-null',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: 'test', context: {}, priority: 'normal' },
    }
    await expect(producer.publish(msg)).rejects.toThrow('null')
    expect(mockXadd).toHaveBeenCalledTimes(4)
  })
})
