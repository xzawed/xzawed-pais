import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('../redis.client.js', () => ({
  getRedisClient: vi.fn(),
}))

import { getRedisClient } from '../redis.client.js'
import { WatcherEventConsumer } from '../watcher-event-consumer.js'

function makeRedis(xreadgroupResults: unknown[][] = []) {
  let callCount = 0
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockImplementation(() => {
      if (callCount >= xreadgroupResults.length) {
        // CLAUDE.md 패턴: setImmediate로 macrotask 양보 — OOM 방지
        return new Promise<null>(r => setImmediate(() => r(null)))
      }
      return Promise.resolve(xreadgroupResults[callCount++])
    }),
    xack: vi.fn().mockResolvedValue(1),
  }
}

afterEach(() => vi.clearAllMocks())

describe('WatcherEventConsumer', () => {
  it('생성 시 redisUrl과 onFileChanged 콜백을 받는다', () => {
    const cb = vi.fn()
    const consumer = new WatcherEventConsumer('redis://localhost', cb)
    expect(consumer).toBeDefined()
  })

  it('start()와 stop() 메서드가 존재한다', () => {
    const consumer = new WatcherEventConsumer('redis://localhost', vi.fn())
    expect(typeof consumer.start).toBe('function')
    expect(typeof consumer.stop).toBe('function')
  })

  it('watchSession()과 unwatchSession() 메서드가 존재한다', () => {
    const consumer = new WatcherEventConsumer('redis://localhost', vi.fn())
    expect(typeof consumer.watchSession).toBe('function')
    expect(typeof consumer.unwatchSession).toBe('function')
  })

  it('watchSession()이 세션을 추적하고 unwatchSession()이 제거한다', () => {
    const consumer = new WatcherEventConsumer('redis://localhost', vi.fn())
    consumer.watchSession('session-a')
    consumer.watchSession('session-b')
    // unwatchSession — 두 번 호출해도 에러 없음
    consumer.unwatchSession('session-a')
    consumer.unwatchSession('session-a')
    consumer.unwatchSession('session-b')
  })

  it('_loop()가 watched 세션이 없으면 대기하다가 stop() 호출 후 종료한다', async () => {
    const mockRedis = makeRedis([])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const consumer = new WatcherEventConsumer('redis://localhost:6379', vi.fn())
    consumer.start()
    await new Promise(r => setTimeout(r, 20))
    consumer.stop()

    // 세션 없음 → xreadgroup 미호출
    expect(mockRedis.xreadgroup).not.toHaveBeenCalled()
  })

  it('onFileChanged 콜백이 file_changed 메시지로 호출된다', async () => {
    const sessionId = 'test-session-42'
    const streamKey = `watcher:to-manager:${sessionId}`

    const fileChangedEvent = {
      type: 'file_changed',
      payload: { path: '/workspace/src/index.ts', event: 'change', timestamp: 1234567890 },
    }

    const mockRedis = makeRedis([
      [[streamKey, [['1-0', ['data', JSON.stringify(fileChangedEvent)]]]]]
    ])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const onFileChanged = vi.fn().mockResolvedValue(undefined)
    const consumer = new WatcherEventConsumer('redis://localhost:6379', onFileChanged)
    consumer.watchSession(sessionId)
    consumer.start()

    await new Promise(r => setTimeout(r, 50))
    consumer.stop()

    expect(onFileChanged).toHaveBeenCalledWith({
      sessionId,
      path: '/workspace/src/index.ts',
      event: 'change',
      timestamp: 1234567890,
    })
    expect(mockRedis.xack).toHaveBeenCalledWith(streamKey, 'manager-watcher-consumers', '1-0')
  })

  it('잘못된 JSON 메시지는 xack 후 스킵한다', async () => {
    const sessionId = 'bad-json-session'
    const streamKey = `watcher:to-manager:${sessionId}`

    const mockRedis = makeRedis([
      [[streamKey, [['2-0', ['data', 'not valid json']]]]]
    ])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const onFileChanged = vi.fn()
    const consumer = new WatcherEventConsumer('redis://localhost:6379', onFileChanged)
    consumer.watchSession(sessionId)
    consumer.start()

    await new Promise(r => setTimeout(r, 50))
    consumer.stop()

    expect(onFileChanged).not.toHaveBeenCalled()
    expect(mockRedis.xack).toHaveBeenCalledWith(streamKey, 'manager-watcher-consumers', '2-0')
  })

  it('file_changed 외 타입 메시지는 콜백을 호출하지 않고 xack한다', async () => {
    const sessionId = 'other-type-session'
    const streamKey = `watcher:to-manager:${sessionId}`

    const mockRedis = makeRedis([
      [[streamKey, [['3-0', ['data', JSON.stringify({ type: 'watcher_started', payload: { status: 'ok' } })]]]]]
    ])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const onFileChanged = vi.fn()
    const consumer = new WatcherEventConsumer('redis://localhost:6379', onFileChanged)
    consumer.watchSession(sessionId)
    consumer.start()

    await new Promise(r => setTimeout(r, 50))
    consumer.stop()

    expect(onFileChanged).not.toHaveBeenCalled()
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('BUSYGROUP 에러는 무시하고 루프를 계속한다', async () => {
    const sessionId = 'busygroup-session'
    const streamKey = `watcher:to-manager:${sessionId}`

    const mockRedis = makeRedis([])
    mockRedis.xgroup.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'))
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const consumer = new WatcherEventConsumer('redis://localhost:6379', vi.fn())
    consumer.watchSession(sessionId)
    consumer.start()

    await new Promise(r => setTimeout(r, 50))
    consumer.stop()

    expect(mockRedis.xgroup).toHaveBeenCalledWith(
      'CREATE', streamKey, 'manager-watcher-consumers', '$', 'MKSTREAM'
    )
    expect(mockRedis.xreadgroup).toHaveBeenCalled()
  })

  it('watchSession() MAX_SESSIONS(1000) 초과 시 추가하지 않는다', () => {
    const consumer = new WatcherEventConsumer('redis://localhost', vi.fn())
    for (let i = 0; i < 1000; i++) {
      consumer.watchSession(`session-${i}`)
    }
    consumer.watchSession('overflow-session')
    // 에러 없이 조용히 무시
  })
})
