import { vi, describe, it, expect } from 'vitest'
import { Consumer } from './consumer.js'
import type { ManagerToTesterMessage } from '../types.js'

const SESSION_ID = '00000000-0000-0000-0000-000000000001'

const testRequest: ManagerToTesterMessage = {
  sessionId: SESSION_ID,
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

    await consumer.start(SESSION_ID)
    expect(redis.xgroup).toHaveBeenCalledWith(
      'CREATE', `manager:to-tester:${SESSION_ID}`, 'tester-consumers', '$', 'MKSTREAM',
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
        return [[`manager:to-tester:${SESSION_ID}`, [['1-0', ['data', JSON.stringify(testRequest)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start(SESSION_ID)
    expect(handler).toHaveBeenCalledWith(testRequest)
    expect(redis.xack).toHaveBeenCalledWith(`manager:to-tester:${SESSION_ID}`, 'tester-consumers', '1-0')
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
        return [[`manager:to-tester:${SESSION_ID}`, [['1-0', ['data', JSON.stringify({ bad: true })]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start(SESSION_ID)
    expect(handler).not.toHaveBeenCalled()
    expect(redis.xack).toHaveBeenCalled()
  })
})
