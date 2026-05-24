import { vi, describe, it, expect } from 'vitest'
import { Consumer } from './consumer.js'
import type { ManagerToTesterMessage } from '../types.js'

const testRequest: ManagerToTesterMessage = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'test_request',
  payload: { projectPath: '/workspace/project', context: {} },
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
      'CREATE', 'manager:to-tester:sess-1', 'tester-consumers', '$', 'MKSTREAM',
    )
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
        return [['manager:to-tester:sess-1', [['1-0', ['data', JSON.stringify(testRequest)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(handler).toHaveBeenCalledWith(testRequest)
    expect(redis.xack).toHaveBeenCalledWith('manager:to-tester:sess-1', 'tester-consumers', '1-0')
  })

  it('유효하지 않은 메시지는 xack하고 핸들러를 호출하지 않는다', async () => {
    const redis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xack: vi.fn().mockResolvedValue(1),
      xreadgroup: vi.fn(),
    }
    const handler = vi.fn()
    const consumer = new Consumer(redis as any, handler)

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [['manager:to-tester:sess-1', [['1-0', ['data', JSON.stringify({ bad: true })]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(handler).not.toHaveBeenCalled()
    expect(redis.xack).toHaveBeenCalled()
  })
})
