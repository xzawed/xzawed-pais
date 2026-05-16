import { vi, describe, it, expect } from 'vitest'
import { Producer } from './producer.js'
import type { BuilderToManagerMessage } from '../types.js'

function makeRedis() {
  return { xadd: vi.fn().mockResolvedValue('1-0') }
}

const buildComplete = (sessionId: string): BuilderToManagerMessage => ({
  sessionId,
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'build_complete',
  payload: { success: true, content: '빌드 완료', duration: 500 },
})

describe('Producer', () => {
  it('build_complete를 올바른 스트림에 발행한다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    await producer.publish('sess-1', buildComplete('sess-1'))
    expect(redis.xadd).toHaveBeenCalledWith(
      'builder:to-manager:sess-1',
      '*',
      'data',
      expect.stringContaining('"type":"build_complete"')
    )
  })

  it('sessionId가 다르면 다른 스트림에 발행한다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    await producer.publish('sess-2', buildComplete('sess-2'))
    expect(redis.xadd).toHaveBeenCalledWith(
      'builder:to-manager:sess-2',
      '*',
      'data',
      expect.any(String)
    )
  })
})
