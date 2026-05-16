import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OrchestratorToManagerMessage } from '../../src/types/streams.js'

const mockXreadgroup = vi.fn()
const mockXgroup = vi.fn().mockResolvedValue('OK')
const mockXack = vi.fn().mockResolvedValue(1)

vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    xreadgroup = mockXreadgroup
    xgroup = mockXgroup
    xack = mockXack
    quit = vi.fn()
  },
}))

describe('StreamConsumer', () => {
  beforeEach(() => {
    mockXreadgroup.mockReset()
    mockXgroup.mockClear()
    mockXack.mockClear()
  })

  it('calls handler for each received message and ACKs it', async () => {
    const msg: OrchestratorToManagerMessage = {
      sessionId: 'sess-1',
      messageId: 'msg-1',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: 'build app', context: {}, priority: 'normal' },
    }

    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')

    let calls = 0
    mockXreadgroup.mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return [['orchestrator:to-manager:sess-1', [['1234-0', ['data', JSON.stringify(msg)]]]]]
      }
      consumer.stop()
      return null
    })

    const handler = vi.fn().mockResolvedValue(undefined)
    await consumer.start('sess-1', handler)

    expect(handler).toHaveBeenCalledWith(msg)
    expect(mockXack).toHaveBeenCalledWith(
      'orchestrator:to-manager:sess-1',
      'manager-consumers',
      '1234-0',
    )
  })

  it('creates consumer group with MKSTREAM on ensureGroup', async () => {
    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')
    await consumer.ensureGroup('sess-2')
    expect(mockXgroup).toHaveBeenCalledWith(
      'CREATE',
      'orchestrator:to-manager:sess-2',
      'manager-consumers',
      '$',
      'MKSTREAM',
    )
  })

  it('ignores BUSYGROUP error on ensureGroup', async () => {
    mockXgroup.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group already exists'))
    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')
    await expect(consumer.ensureGroup('sess-3')).resolves.toBeUndefined()
  })
})
