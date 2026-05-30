import { describe, it, expect, vi, beforeEach } from 'vitest'
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

describe('StreamProducer', () => {
  beforeEach(() => { mockXadd.mockClear() })

  it('throws when xadd returns null (stream at MAXLEN)', async () => {
    mockXadd.mockResolvedValueOnce(null)
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
  })

  it('publishes message to orchestrator:to-manager stream', async () => {
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: OrchestratorToManagerMessage = {
      sessionId: VALID_SESSION_ID_2,
      messageId: 'msg-1',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: '쇼핑몰 만들기', context: {}, priority: 'normal' },
    }

    await producer.publish(msg)

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
})
