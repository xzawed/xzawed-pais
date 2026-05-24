import { vi, describe, it, expect } from 'vitest'
import { Producer } from './producer.js'
import type { DesignerToManagerMessage } from '../types.js'

const message: DesignerToManagerMessage = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'design_complete',
  payload: { content: 'Design complete' },
}

describe('Producer', () => {
  it('유효한 UUID sessionId로 메시지를 발행한다', async () => {
    const redis = { xadd: vi.fn().mockResolvedValue('1-0') }
    const producer = new Producer(redis as any)
    const validUuid = '550e8400-e29b-41d4-a716-446655440000'

    await producer.publish(validUuid, message)
    expect(redis.xadd).toHaveBeenCalledWith(
      `designer:to-manager:${validUuid}`, '*', 'data', JSON.stringify(message),
    )
  })

  it('UUID가 아닌 sessionId는 오류를 던진다', async () => {
    const redis = { xadd: vi.fn() }
    const producer = new Producer(redis as any)

    await expect(producer.publish('not-a-uuid', message)).rejects.toThrow()
    expect(redis.xadd).not.toHaveBeenCalled()
  })
})
