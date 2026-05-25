import { vi, describe, it, expect } from 'vitest'
import { Producer } from './producer.js'
import type { PlannerToManagerMessage } from '../types.js'

function makeRedis() {
  return { xadd: vi.fn().mockResolvedValue('1-0') }
}

const planComplete = (sessionId: string): PlannerToManagerMessage => ({
  sessionId,
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'plan_complete',
  payload: {
    steps: [],
    estimatedTime: '1 hour',
    content: '계획 완료',
  },
})

describe('Producer', () => {
  it('plan_complete를 올바른 스트림에 발행한다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    await producer.publish('sess-1', planComplete('sess-1'))
    expect(redis.xadd).toHaveBeenCalledWith(
      'planner:to-manager:sess-1',
      '*',
      'data',
      expect.stringContaining('"type":"plan_complete"')
    )
  })

  it('sessionId가 다르면 다른 스트림에 발행한다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    await producer.publish('sess-2', planComplete('sess-2'))
    expect(redis.xadd).toHaveBeenCalledWith(
      'planner:to-manager:sess-2',
      '*',
      'data',
      expect.any(String)
    )
  })

  it('info_request 타입도 올바르게 발행한다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    const msg: PlannerToManagerMessage = {
      sessionId: 'sess-1',
      messageId: 'msg-2',
      timestamp: 2000,
      type: 'info_request',
      payload: {
        content: '추가 정보가 필요합니다',
        uiSpec: { type: 'form', fields: [] },
      },
    }
    await producer.publish('sess-1', msg)
    expect(redis.xadd).toHaveBeenCalledWith(
      'planner:to-manager:sess-1',
      '*',
      'data',
      expect.stringContaining('"type":"info_request"')
    )
  })
})
