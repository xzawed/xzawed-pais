import { vi, describe, it, expect } from 'vitest'
import { Producer } from './producer.js'
import type { PlannerToManagerMessage } from '../types.js'

const SESSION_A = '00000000-0000-0000-0000-000000000001'
const SESSION_B = '00000000-0000-0000-0000-000000000002'

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
    await producer.publish(SESSION_A, planComplete(SESSION_A))
    expect(redis.xadd).toHaveBeenCalledWith(
      `planner:to-manager:${SESSION_A}`,
      '*',
      'data',
      expect.stringContaining('"type":"plan_complete"')
    )
  })

  it('sessionId가 다르면 다른 스트림에 발행한다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    await producer.publish(SESSION_B, planComplete(SESSION_B))
    expect(redis.xadd).toHaveBeenCalledWith(
      `planner:to-manager:${SESSION_B}`,
      '*',
      'data',
      expect.any(String)
    )
  })

  it('info_request 타입도 올바르게 발행한다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    const msg: PlannerToManagerMessage = {
      sessionId: SESSION_A,
      messageId: 'msg-2',
      timestamp: 2000,
      type: 'info_request',
      payload: {
        content: '추가 정보가 필요합니다',
        uiSpec: { type: 'form', fields: [] },
      },
    }
    await producer.publish(SESSION_A, msg)
    expect(redis.xadd).toHaveBeenCalledWith(
      `planner:to-manager:${SESSION_A}`,
      '*',
      'data',
      expect.stringContaining('"type":"info_request"')
    )
  })

  it('비 UUID sessionId는 오류를 던진다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    await expect(producer.publish('invalid-session', planComplete('invalid-session'))).rejects.toThrow()
    expect(redis.xadd).not.toHaveBeenCalled()
  })
})
