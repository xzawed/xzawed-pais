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

  // CQ-1: xreadgroup not in try/catch — consumer should survive Redis disconnect
  it('CQ-1: continues loop when xreadgroup throws (Redis disconnect recovery)', async () => {
    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')

    let calls = 0
    const msg: OrchestratorToManagerMessage = {
      sessionId: 'sess-cq1',
      messageId: 'msg-cq1',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: 'test', context: {}, priority: 'normal' },
    }

    mockXreadgroup.mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('ECONNRESET Redis connection lost')
      if (calls === 2) {
        return [['orchestrator:to-manager:sess-cq1', [['5678-0', ['data', JSON.stringify(msg)]]]]]
      }
      consumer.stop()
      return null
    })

    const handler = vi.fn().mockResolvedValue(undefined)
    // Should NOT throw — the consumer must survive the disconnect and process the next message
    await consumer.start('sess-cq1', handler)

    expect(handler).toHaveBeenCalledWith(msg)
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  // CQ-4: xack must be called even when handler throws (try/finally guarantee)
  it('CQ-4: xack is called even when handler throws (finally guarantee)', async () => {
    const msg: OrchestratorToManagerMessage = {
      sessionId: 'sess-cq4',
      messageId: 'msg-cq4',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: 'fail', context: {}, priority: 'normal' },
    }

    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')

    let calls = 0
    mockXreadgroup.mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return [['orchestrator:to-manager:sess-cq4', [['9999-0', ['data', JSON.stringify(msg)]]]]]
      }
      consumer.stop()
      return null
    })

    // Handler throws — xack must still be called (finally semantics)
    const throwingHandler = vi.fn().mockRejectedValue(new Error('handler exploded'))
    await consumer.start('sess-cq4', throwingHandler)

    expect(throwingHandler).toHaveBeenCalledWith(msg)
    expect(mockXack).toHaveBeenCalledWith(
      'orchestrator:to-manager:sess-cq4',
      'manager-consumers',
      '9999-0',
    )
  })

  // CQ-4 (structural): xack must be called exactly once even when handler throws
  it('CQ-4: xack is called exactly once even when handler throws (not skipped by catch path)', async () => {
    const msg: OrchestratorToManagerMessage = {
      sessionId: 'sess-cq4b',
      messageId: 'msg-cq4b',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: 'fail2', context: {}, priority: 'normal' },
    }

    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')

    let callCount = 0
    mockXreadgroup.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return [['orchestrator:to-manager:sess-cq4b', [['1111-0', ['data', JSON.stringify(msg)]]]]]
      }
      consumer.stop()
      return null
    })

    const handler = vi.fn().mockRejectedValue(new Error('handler fail'))
    await consumer.start('sess-cq4b', handler)

    expect(mockXack).toHaveBeenCalledTimes(1)
    expect(mockXack).toHaveBeenCalledWith('orchestrator:to-manager:sess-cq4b', 'manager-consumers', '1111-0')
  })
})
