import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OrchestratorToManagerMessage } from '@xzawed/shared'

const mockXadd = vi.fn().mockResolvedValue('1234-0')
vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    xadd = mockXadd
    quit = vi.fn()
  }
}))

describe('StreamProducer', () => {
  beforeEach(() => { mockXadd.mockClear() })

  it('publishes message to orchestrator:to-manager stream', async () => {
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: OrchestratorToManagerMessage = {
      sessionId: 'sess-1',
      messageId: 'msg-1',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: '쇼핑몰 만들기', context: {}, priority: 'normal' },
    }

    await producer.publish(msg)

    expect(mockXadd).toHaveBeenCalledWith(
      'orchestrator:to-manager:sess-1',
      '*',
      'data',
      JSON.stringify(msg)
    )
  })
})
