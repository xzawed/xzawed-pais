import { vi, describe, it, expect, beforeEach } from 'vitest'
import { StreamConsumer } from '../../src/streams/consumer.js'

vi.mock('../../src/streams/redis.client.js', () => ({
  getRedisClient: vi.fn(),
}))

import { getRedisClient } from '../../src/streams/redis.client.js'

function makeRedis(overrides: Record<string, unknown> = {}) {
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    ...overrides,
  }
}

const validMsg = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'status_update',
  payload: { agentId: 'planner', content: 'Step done' },
}

describe('StreamConsumer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ensureGroup은 consumer group을 생성한다', async () => {
    const redis = makeRedis()
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const consumer = new StreamConsumer('redis://localhost:6379')
    await consumer.ensureGroup('sess-1')

    expect(redis.xgroup).toHaveBeenCalledWith(
      'CREATE', 'manager:to-orchestrator:sess-1', 'orchestrator-consumers', '$', 'MKSTREAM',
    )
  })

  it('ensureGroup은 BUSYGROUP 오류를 무시한다', async () => {
    const redis = makeRedis({
      xgroup: vi.fn().mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists')),
    })
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const consumer = new StreamConsumer('redis://localhost:6379')
    await expect(consumer.ensureGroup('sess-1')).resolves.not.toThrow()
  })

  it('ensureGroup은 BUSYGROUP 외 오류를 전파한다', async () => {
    const redis = makeRedis({
      xgroup: vi.fn().mockRejectedValue(new Error('WRONGTYPE error')),
    })
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const consumer = new StreamConsumer('redis://localhost:6379')
    await expect(consumer.ensureGroup('sess-1')).rejects.toThrow('WRONGTYPE error')
  })

  it('start는 메시지를 수신해 핸들러를 호출하고 xack한다', async () => {
    const redis = makeRedis()
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const handler = vi.fn().mockResolvedValue(undefined)
    const consumer = new StreamConsumer('redis://localhost:6379')

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [['manager:to-orchestrator:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1', handler)
    expect(handler).toHaveBeenCalledWith(validMsg)
    expect(redis.xack).toHaveBeenCalledWith('manager:to-orchestrator:sess-1', 'orchestrator-consumers', '1-0')
  })

  it('유효하지 않은 메시지는 xack하고 핸들러를 호출하지 않는다', async () => {
    const redis = makeRedis()
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const handler = vi.fn()
    const consumer = new StreamConsumer('redis://localhost:6379')

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [['manager:to-orchestrator:sess-1', [['1-0', ['data', JSON.stringify({ bad: true })]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1', handler)
    expect(handler).not.toHaveBeenCalled()
    expect(redis.xack).toHaveBeenCalledWith('manager:to-orchestrator:sess-1', 'orchestrator-consumers', '1-0')
  })

  it('JSON 파싱 실패 시 xack하고 skip한다', async () => {
    const redis = makeRedis()
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const handler = vi.fn()
    const consumer = new StreamConsumer('redis://localhost:6379')

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [['manager:to-orchestrator:sess-1', [['1-0', ['data', 'not-valid-json']]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1', handler)
    expect(handler).not.toHaveBeenCalled()
    expect(redis.xack).toHaveBeenCalled()
  })

  it('data 필드 없는 메시지는 xack하고 skip한다', async () => {
    const redis = makeRedis()
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const handler = vi.fn()
    const consumer = new StreamConsumer('redis://localhost:6379')

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [['manager:to-orchestrator:sess-1', [['1-0', ['other', 'field']]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1', handler)
    expect(handler).not.toHaveBeenCalled()
    expect(redis.xack).toHaveBeenCalled()
  })

  it('핸들러 예외 시에도 xack를 실행한다', async () => {
    const redis = makeRedis()
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const handler = vi.fn().mockRejectedValue(new Error('handler error'))
    const consumer = new StreamConsumer('redis://localhost:6379')

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [['manager:to-orchestrator:sess-1', [['1-0', ['data', JSON.stringify(validMsg)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1', handler).catch(() => {})
    expect(redis.xack).toHaveBeenCalled()
  })

  it('xreadgroup 오류 시 루프를 계속한다', async () => {
    const redis = makeRedis()
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const consumer = new StreamConsumer('redis://localhost:6379')

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('redis error')
      consumer.stop()
      return null
    })

    await consumer.start('sess-1', vi.fn())
    expect(redis.xreadgroup).toHaveBeenCalledTimes(2)
  })

  it('stop() 후 xreadgroup 오류는 즉시 반환한다', async () => {
    const redis = makeRedis()
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const consumer = new StreamConsumer('redis://localhost:6379')

    redis.xreadgroup.mockImplementation(async () => {
      consumer.stop()
      throw new Error('redis error')
    })

    await expect(consumer.start('sess-1', vi.fn())).resolves.not.toThrow()
    expect(redis.xreadgroup).toHaveBeenCalledTimes(1)
  })

  it('stop()은 루프를 종료한다', async () => {
    const redis = makeRedis()
    vi.mocked(getRedisClient).mockReturnValue(redis as any)

    const consumer = new StreamConsumer('redis://localhost:6379')
    let readCalls = 0

    redis.xreadgroup.mockImplementation(async () => {
      readCalls++
      consumer.stop()
      return null
    })

    await consumer.start('sess-1', vi.fn())
    expect(readCalls).toBe(1)
  })
})
