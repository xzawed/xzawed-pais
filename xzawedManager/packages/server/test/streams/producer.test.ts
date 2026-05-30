import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ManagerToOrchestratorMessage } from '../../src/types/streams.js'

const mockXadd = vi.fn().mockResolvedValue('1234-0')
vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    xadd = mockXadd
    quit = vi.fn()
  }
}))

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
  it('publishes successfully on first attempt', async () => {
    mockXadd.mockResolvedValue('1234-0')
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: ManagerToOrchestratorMessage = {
      sessionId: 'sess-1',
      messageId: 'msg-1',
      timestamp: 1000,
      type: 'status_update',
      payload: { agentId: 'manager', content: 'Starting plan_task...' },
    }

    const id = await producer.publish(msg)

    expect(id).toBe('1234-0')
    expect(mockXadd).toHaveBeenCalledTimes(1)
    expect(mockXadd).toHaveBeenCalledWith(
      'manager:to-orchestrator:sess-1',
      '*',
      'data',
      JSON.stringify(msg)
    )
  })

  it('retries on transient xadd failure and succeeds on second attempt', async () => {
    mockXadd
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('5678-0')
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: ManagerToOrchestratorMessage = {
      sessionId: 'sess-retry',
      messageId: 'msg-retry',
      timestamp: 2000,
      type: 'status_update',
      payload: { agentId: 'manager', content: 'retry test' },
    }

    const id = await producer.publish(msg)

    expect(id).toBe('5678-0')
    expect(mockXadd).toHaveBeenCalledTimes(2)
  })

  it('throws after all retries are exhausted', async () => {
    mockXadd.mockRejectedValue(new Error('Redis connection lost'))
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: ManagerToOrchestratorMessage = {
      sessionId: 'sess-fail',
      messageId: 'msg-fail',
      timestamp: 3000,
      type: 'status_update',
      payload: { agentId: 'manager', content: 'failure test' },
    }

    await expect(producer.publish(msg)).rejects.toThrow('Redis connection lost')
    // 최초 1회 + 재시도 3회 = 총 4회
    expect(mockXadd).toHaveBeenCalledTimes(4)
  })

  it('throws when xadd returns null (stream at MAXLEN) after all retries', async () => {
    mockXadd.mockResolvedValue(null)
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')
    const msg: ManagerToOrchestratorMessage = {
      sessionId: 'sess-null',
      messageId: 'msg-null',
      timestamp: 1000,
      type: 'status_update',
      payload: { agentId: 'manager', content: 'test' },
    }
    await expect(producer.publish(msg)).rejects.toThrow('null')
    // xadd 자체는 null 반환이므로 catch에서 재시도 → 총 4회
    expect(mockXadd).toHaveBeenCalledTimes(4)
  })
})
