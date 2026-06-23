import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('./redis.client.js', () => ({
  getRedisClient: vi.fn(),
}))

import { getRedisClient } from '../streams/redis.client.js'
import { WatcherEventConsumer } from './watcher-event-consumer.js'

/**
 * readGroupMulti는 내부적으로 xreadgroup을 호출한다.
 * RawStreamReply = [string, [string, string[]][]][]
 * xreadgroupResults: 각 호출마다 반환할 RawStreamReply 배열
 */
function makeRedis(xreadgroupResults: unknown[][] = []) {
  let callCount = 0
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockImplementation(() => {
      if (callCount >= xreadgroupResults.length) {
        return new Promise<null>(r => setImmediate(() => r(null)))
      }
      return Promise.resolve(xreadgroupResults[callCount++])
    }),
    xack: vi.fn().mockResolvedValue(1),
    xadd: vi.fn().mockResolvedValue('1-0'),
    disconnect: vi.fn(),
  }
}

afterEach(() => vi.clearAllMocks())

describe('WatcherEventConsumer — 기본 동작', () => {
  it('file_changed 메시지를 onFileChanged로 전달한다', async () => {
    const sid = 's1'
    const stream = `watcher:to-manager:${sid}`
    const evt = { type: 'file_changed', payload: { path: 'a.ts', event: 'change', timestamp: 1 } }
    const mockRedis = makeRedis([[[stream, [['1-0', ['data', JSON.stringify(evt)]]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const onFileChanged = vi.fn().mockResolvedValue(undefined)
    const c = new WatcherEventConsumer('redis://localhost:6379', onFileChanged)
    c.watchSession(sid); c.start()
    await new Promise(r => setTimeout(r, 50)); c.stop()
    expect(onFileChanged).toHaveBeenCalledTimes(1)
    expect(onFileChanged.mock.calls[0]![0]).toMatchObject({ sessionId: sid, path: 'a.ts', event: 'change' })
    expect(mockRedis.xack).toHaveBeenCalled()
  })
})

describe('WatcherEventConsumer — 인바운드 DLQ 격리', () => {
  it('JSON 무효를 {stream}:dlq로 격리(invalid_schema)', async () => {
    const sid = 's1'
    const stream = `watcher:to-manager:${sid}`
    const mockRedis = makeRedis([[[stream, [['7-0', ['data', 'not json']]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const onFileChanged = vi.fn()
    const c = new WatcherEventConsumer('redis://localhost:6379', onFileChanged)
    c.watchSession(sid); c.start()
    await new Promise(r => setTimeout(r, 50)); c.stop()
    expect(onFileChanged).not.toHaveBeenCalled()
    expect(mockRedis.xadd.mock.calls[0]![0]).toBe(`${stream}:dlq`)
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('onFileChanged throw를 {stream}:dlq로 격리(handler_failed·재시도 없음)', async () => {
    const sid = 's1'
    const stream = `watcher:to-manager:${sid}`
    const evt = { type: 'file_changed', payload: { path: 'a.ts', event: 'change', timestamp: 1 } }
    const mockRedis = makeRedis([[[stream, [['7-1', ['data', JSON.stringify(evt)]]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const onFileChanged = vi.fn().mockRejectedValue(new Error('boom'))
    const c = new WatcherEventConsumer('redis://localhost:6379', onFileChanged)
    c.watchSession(sid); c.start()
    await new Promise(r => setTimeout(r, 50)); c.stop()
    expect(onFileChanged).toHaveBeenCalledTimes(1)
    expect(mockRedis.xadd.mock.calls[0]![0]).toBe(`${stream}:dlq`)
  })

  it('non-file_changed 메시지는 DLQ 없이 ack-skip', async () => {
    const sid = 's1'
    const stream = `watcher:to-manager:${sid}`
    const mockRedis = makeRedis([[[stream, [['7-2', ['data', JSON.stringify({ type: 'ping' })]]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const c = new WatcherEventConsumer('redis://localhost:6379', vi.fn())
    c.watchSession(sid); c.start()
    await new Promise(r => setTimeout(r, 50)); c.stop()
    expect(mockRedis.xadd).not.toHaveBeenCalled()
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('data 필드 없는 구조적 결함은 DLQ 없이 ack-skip', async () => {
    const sid = 's1'
    const stream = `watcher:to-manager:${sid}`
    const mockRedis = makeRedis([[[stream, [['7-3', ['nodata', 'x']]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const c = new WatcherEventConsumer('redis://localhost:6379', vi.fn())
    c.watchSession(sid); c.start()
    await new Promise(r => setTimeout(r, 50)); c.stop()
    expect(mockRedis.xadd).not.toHaveBeenCalled()
    expect(mockRedis.xack).toHaveBeenCalled()
  })
})
