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

function makeMsg(sessionId: string, intent = 'test'): OrchestratorToManagerMessage {
  return {
    sessionId,
    messageId: `msg-${sessionId}`,
    timestamp: 1000,
    type: 'task_request',
    payload: { intent, context: {}, priority: 'normal' },
  }
}

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
    const msg = makeMsg('sess-cq1')

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

  it('recreates consumer group and continues when xreadgroup throws NOGROUP', async () => {
    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')

    const msg = makeMsg('sess-nogroup')
    let calls = 0
    mockXreadgroup.mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('NOGROUP No such key or consumer group')
      if (calls === 2) {
        return [['orchestrator:to-manager:sess-nogroup', [['1-0', ['data', JSON.stringify(msg)]]]]]
      }
      consumer.stop()
      return null
    })

    const handler = vi.fn().mockResolvedValue(undefined)
    await consumer.start('sess-nogroup', handler)

    // NOGROUP 분기 → ensureGroup 재생성(xgroup CREATE: start 시 1회 + 복구 시 1회) 후 정상 처리
    expect(handler).toHaveBeenCalledWith(msg)
    expect(mockXgroup).toHaveBeenCalledWith(
      'CREATE',
      'orchestrator:to-manager:sess-nogroup',
      'manager-consumers',
      '$',
      'MKSTREAM',
    )
    expect(mockXgroup.mock.calls.filter(c => c[1] === 'orchestrator:to-manager:sess-nogroup').length)
      .toBeGreaterThanOrEqual(2)
  })

  // CQ-4: xack must be called exactly once with correct args even when handler throws (try/finally guarantee)
  it('CQ-4: xack is called exactly once with correct args when handler throws (finally guarantee)', async () => {
    const msg = makeMsg('sess-cq4', 'fail')

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

    // Handler throws — xack must still be called exactly once (finally semantics)
    const throwingHandler = vi.fn().mockRejectedValue(new Error('handler exploded'))
    await consumer.start('sess-cq4', throwingHandler)

    expect(throwingHandler).toHaveBeenCalledWith(msg)
    expect(mockXack).toHaveBeenCalledTimes(1)
    expect(mockXack).toHaveBeenCalledWith(
      'orchestrator:to-manager:sess-cq4',
      'manager-consumers',
      '9999-0',
    )
  })
})
