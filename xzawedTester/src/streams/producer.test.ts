import { vi, describe, it, expect } from 'vitest'
import { Producer } from './producer.js'
import type { TesterToManagerMessage } from '../types.js'

const SESSION_ID = '00000000-0000-0000-0000-000000000001'

const message: TesterToManagerMessage = {
  sessionId: SESSION_ID,
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'test_complete',
  payload: { success: true, passed: 10, failed: 0, content: 'All tests passed' },
}

describe('Producer', () => {
  it('메시지를 올바른 스트림에 발행한다', async () => {
    const redis = { xadd: vi.fn().mockResolvedValue('1-0') }
    const producer = new Producer(redis as any)

    await producer.publish(SESSION_ID, message)
    expect(redis.xadd).toHaveBeenCalledWith(
      `tester:to-manager:${SESSION_ID}`, '*', 'data', JSON.stringify(message),
    )
  })
})
