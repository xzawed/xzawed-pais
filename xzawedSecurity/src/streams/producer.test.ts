import { vi, describe, it, expect } from 'vitest'
import { Producer } from './producer.js'
import type { SecurityToManagerMessage } from '../types.js'

const message: SecurityToManagerMessage = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'audit_complete',
  payload: { score: 95, content: 'Audit complete' },
}

describe('Producer', () => {
  it('메시지를 올바른 스트림에 발행한다', async () => {
    const redis = { xadd: vi.fn().mockResolvedValue('1-0') }
    const producer = new Producer(redis as any)

    await producer.publish('sess-1', message)
    expect(redis.xadd).toHaveBeenCalledWith(
      'security:to-manager:sess-1', '*', 'data', JSON.stringify(message),
    )
  })
})
