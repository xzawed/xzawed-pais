import { vi, describe, it, expect } from 'vitest'
import { Consumer } from './consumer.js'
import type { ManagerToDesignerMessage } from '../types.js'

const designRequest: ManagerToDesignerMessage = {
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'design_request',
  payload: { intent: 'Build a login form', context: {} },
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
      'CREATE', 'manager:to-designer:sess-1', 'designer-consumers', '$', 'MKSTREAM',
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
        return [['manager:to-designer:sess-1', [['1-0', ['data', JSON.stringify(designRequest)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(handler).toHaveBeenCalledWith(designRequest)
    expect(redis.xack).toHaveBeenCalledWith('manager:to-designer:sess-1', 'designer-consumers', '1-0')
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
        return [['manager:to-designer:sess-1', [['1-0', ['data', JSON.stringify({ bad: true })]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(handler).not.toHaveBeenCalled()
    expect(redis.xack).toHaveBeenCalled()
  })
})
