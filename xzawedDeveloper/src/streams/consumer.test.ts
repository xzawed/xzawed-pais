import { vi, describe, it, expect } from 'vitest'
import { Consumer } from './consumer.js'
import type { ManagerToDeveloperMessage } from '../types.js'

const SESSION_ID = '00000000-0000-0000-0000-000000000001'

const developRequest: ManagerToDeveloperMessage = {
  sessionId: SESSION_ID,
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'develop_request',
  payload: { plan: 'Add login feature', projectPath: '/workspace/project', context: {} },
}

describe('Consumer', () => {
  it('consumer group을 생성한다', async () => {
    const redis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xack: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue('OK'),
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
      'CREATE', `manager:to-developer:${SESSION_ID}`, 'developer-consumers', '$', 'MKSTREAM',
    )
  })

  it('유효한 메시지를 수신해 핸들러를 호출하고 xack한다', async () => {
    const redis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xack: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue('OK'),
      xreadgroup: vi.fn(),
    }
    const handler = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler)

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [[`manager:to-developer:${SESSION_ID}`, [['1-0', ['data', JSON.stringify(developRequest)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start(SESSION_ID)
    expect(handler).toHaveBeenCalledWith(developRequest)
    expect(redis.xack).toHaveBeenCalledWith(`manager:to-developer:${SESSION_ID}`, 'developer-consumers', '1-0')
  })

  it('유효하지 않은 메시지는 xack하고 핸들러를 호출하지 않는다', async () => {
    const redis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xack: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue('OK'),
      xreadgroup: vi.fn(),
    }
    const handler = vi.fn()
    const consumer = new Consumer(redis as any, handler)

    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [[`manager:to-developer:${SESSION_ID}`, [['1-0', ['data', JSON.stringify({ bad: true })]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start(SESSION_ID)
    expect(handler).not.toHaveBeenCalled()
    expect(redis.xack).toHaveBeenCalled()
  })
})
