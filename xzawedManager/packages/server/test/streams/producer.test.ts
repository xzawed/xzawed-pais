import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ManagerToOrchestratorMessage } from '../../src/types/streams.js'

const mockXadd = vi.fn().mockResolvedValue('1234-0')
vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    xadd = mockXadd
    quit = vi.fn()
  }
}))

describe('StreamProducer', () => {
  beforeEach(() => { vi.resetModules(); mockXadd.mockClear() })

  it('throws when xadd returns null (stream at MAXLEN)', async () => {
    mockXadd.mockResolvedValueOnce(null)
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
  })

  it('publishes to manager:to-orchestrator:{sessionId} stream', async () => {
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
    expect(mockXadd).toHaveBeenCalledWith(
      'manager:to-orchestrator:sess-1',
      '*',
      'data',
      JSON.stringify(msg)
    )
  })
})
