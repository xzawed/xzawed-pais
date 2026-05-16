import { vi, describe, it, expect } from 'vitest'
import { Consumer } from './consumer.js'
import type { ManagerToBuilderMessage } from '../types.js'

const buildRequest: ManagerToBuilderMessage = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'build_request',
  payload: {
    projectPath: '/workspace/project',
    target: 'production',
    context: {},
  },
}

describe('Consumer', () => {
  it('consumer group을 생성한다', async () => {
    const redis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xack: vi.fn().mockResolvedValue(1),
      xreadgroup: vi.fn(),
    }
    const handler = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler)

    // stop on first xreadgroup call to prevent infinite loop
    let xreadgroupCalls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (xreadgroupCalls++ === 0) consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(redis.xgroup).toHaveBeenCalledWith(
      'CREATE', 'manager:to-builder:sess-1', 'builder-consumers', '$', 'MKSTREAM'
    )
  })

  it('BUSYGROUP 오류는 무시한다', async () => {
    const redis = {
      xgroup: vi.fn().mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists')),
      xack: vi.fn().mockResolvedValue(1),
      xreadgroup: vi.fn(),
    }
    const handler = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler)

    let xreadgroupCalls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (xreadgroupCalls++ === 0) consumer.stop()
      return null
    })

    await expect(consumer.start('sess-1')).resolves.not.toThrow()
  })

  it('xreadgroup 오류 시 재시도한다', async () => {
    const redis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xack: vi.fn().mockResolvedValue(1),
      xreadgroup: vi.fn(),
    }
    const handler = vi.fn().mockResolvedValue(undefined)
    const noopSleep = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler, noopSleep)

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('Redis connection lost')
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(redis.xreadgroup).toHaveBeenCalledTimes(2)
    expect(noopSleep).toHaveBeenCalledWith(1000)
  })

  it('stop() 호출 후 오류 발생 시 재시도하지 않는다', async () => {
    const redis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xack: vi.fn().mockResolvedValue(1),
      xreadgroup: vi.fn(),
    }
    const handler = vi.fn().mockResolvedValue(undefined)
    const noopSleep = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler, noopSleep)

    redis.xreadgroup.mockImplementation(async () => {
      consumer.stop()
      throw new Error('Redis connection lost')
    })

    await consumer.start('sess-1')
    expect(noopSleep).not.toHaveBeenCalled()
  })

  it('유효하지 않은 메시지는 xack하고 핸들러를 호출하지 않는다', async () => {
    const redis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xack: vi.fn().mockResolvedValue(1),
      xreadgroup: vi.fn(),
    }
    const handler = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler)

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [['manager:to-builder:sess-1', [['1-0', ['data', JSON.stringify({ invalid: true })]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(handler).not.toHaveBeenCalled()
    expect(redis.xack).toHaveBeenCalledWith('manager:to-builder:sess-1', 'builder-consumers', '1-0')
  })

  it('메시지를 수신해 핸들러를 호출하고 xack한다', async () => {
    const redis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xack: vi.fn().mockResolvedValue(1),
      xreadgroup: vi.fn(),
    }
    const handler = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler)

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [['manager:to-builder:sess-1', [['1-0', ['data', JSON.stringify(buildRequest)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(handler).toHaveBeenCalledWith(buildRequest)
    expect(redis.xack).toHaveBeenCalledWith('manager:to-builder:sess-1', 'builder-consumers', '1-0')
  })
})
