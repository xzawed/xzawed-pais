import { vi, describe, it, expect } from 'vitest'
import { Producer } from './producer.js'
import type { DeveloperToManagerMessage } from '../types.js'

const SESSION_ID = '00000000-0000-0000-0000-000000000001'

const message: DeveloperToManagerMessage = {
  sessionId: SESSION_ID,
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'develop_complete',
  payload: { content: 'Development complete', artifacts: ['src/index.ts'] },
}

describe('Producer', () => {
  it('메시지를 올바른 스트림에 발행한다', async () => {
    const redis = { xadd: vi.fn().mockResolvedValue('1-0') }
    const producer = new Producer(redis as any)

    await producer.publish(SESSION_ID, message)
    expect(redis.xadd).toHaveBeenCalledWith(
      `developer:to-manager:${SESSION_ID}`, '*', 'data', JSON.stringify(message),
    )
  })
})
