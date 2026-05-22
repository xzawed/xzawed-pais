import { vi, describe, it, expect } from 'vitest'
import { Consumer } from './consumer.js'
import type { ManagerToPlannerMessage } from '../types.js'

const TEST_SESSION_ID = '00000000-0000-0000-0000-000000000001'

const planRequest: ManagerToPlannerMessage = {
  sessionId: TEST_SESSION_ID,
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'plan_request',
  payload: {
    intent: '로그인 페이지 구현',
    context: {},
    priority: 'normal',
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

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(redis.xgroup).toHaveBeenCalledWith(
      'CREATE', 'manager:to-planner:sess-1', 'planner-consumers', '$', 'MKSTREAM'
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

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) consumer.stop()
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
        return [['manager:to-planner:sess-1', [['1-0', ['data', JSON.stringify({ invalid: true })]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(handler).not.toHaveBeenCalled()
    expect(redis.xack).toHaveBeenCalledWith('manager:to-planner:sess-1', 'planner-consumers', '1-0')
  })

  it('유효한 메시지를 수신해 핸들러를 호출하고 xack한다', async () => {
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
        return [['manager:to-planner:sess-1', [['1-0', ['data', JSON.stringify(planRequest)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(handler).toHaveBeenCalledWith(planRequest)
    expect(redis.xack).toHaveBeenCalledWith('manager:to-planner:sess-1', 'planner-consumers', '1-0')
  })
})
