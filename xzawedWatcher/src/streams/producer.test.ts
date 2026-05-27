import { vi, describe, it, expect } from 'vitest'
import { Producer } from './producer.js'
import type { WatcherToManagerMessage } from '../types.js'

const message: WatcherToManagerMessage = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'watch_started',
  payload: { watcherId: 'w1', content: 'Watch started' },
}

describe('Producer', () => {
  it('메시지를 올바른 스트림에 발행한다', async () => {
    const redis = { xadd: vi.fn().mockResolvedValue('1-0') }
    const producer = new Producer(redis as any)

    await producer.publish('sess-1', message)
    expect(redis.xadd).toHaveBeenCalledWith(
      'watcher:to-manager:sess-1', 'MAXLEN', '~', '1000', '*', 'data', JSON.stringify(message),
    )
  })
})
