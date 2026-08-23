import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('./redis.client.js', () => ({
  getRedisClient: vi.fn(),
}))

import { getRedisClient } from '../streams/redis.client.js'
import { SessionGatewayConsumer } from './session-gateway.js'

function makeRedis(xreadgroupResults: unknown[][] = []) {
  let callCount = 0
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockImplementation(() => {
      if (callCount >= xreadgroupResults.length) {
        // Simulate BLOCK timeout — yield to macrotask queue so stop()/setTimeout can fire
        return new Promise<null>(r => setImmediate(() => r(null)))
      }
      return Promise.resolve(xreadgroupResults[callCount++])
    }),
    xack: vi.fn().mockResolvedValue(1),
    xadd: vi.fn().mockResolvedValue('1-0'),
  }
}

afterEach(() => vi.clearAllMocks())

describe('SessionGatewayConsumer', () => {
  it('세션 알림 수신 시 onSessionInit 콜백을 호출한다', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const mockRedis = makeRedis([
      [['orchestrator:to-manager:sessions', [['1-0', ['data', JSON.stringify({ sessionId })]]]]]
    ])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const onSessionInit = vi.fn()
    const gateway = new SessionGatewayConsumer('redis://localhost:6379', onSessionInit)

    // Run one iteration then stop
    let resolved = false
    const p = gateway.start().then(() => { resolved = true })
    await new Promise(r => setTimeout(r, 50))
    gateway.stop()
    await p

    expect(onSessionInit).toHaveBeenCalledWith(sessionId)
    expect(mockRedis.xack).toHaveBeenCalledWith(
      'orchestrator:to-manager:sessions',
      'manager-gateway',
      '1-0',
    )
    expect(resolved).toBe(true)
  })

  it('잘못된 JSON은 xack 후 스킵한다', async () => {
    const mockRedis = makeRedis([
      [['orchestrator:to-manager:sessions', [['2-0', ['data', 'bad json']]]]]
    ])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const onSessionInit = vi.fn()
    const gateway = new SessionGatewayConsumer('redis://localhost:6379', onSessionInit)

    const p = gateway.start()
    await new Promise(r => setTimeout(r, 50))
    gateway.stop()
    await p

    expect(onSessionInit).not.toHaveBeenCalled()
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('BUSYGROUP 에러는 무시한다', async () => {
    const mockRedis = makeRedis([])
    mockRedis.xgroup.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'))
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const gateway = new SessionGatewayConsumer('redis://localhost:6379', vi.fn())
    const p = gateway.start()
    await new Promise(r => setTimeout(r, 50))
    gateway.stop()
    await expect(p).resolves.toBeUndefined()
  })

  it('JSON 무효를 {stream}:dlq로 격리(invalid_schema)', async () => {
    const mockRedis = makeRedis([[['orchestrator:to-manager:sessions', [['8-0', ['data', 'bad json']]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const onSessionInit = vi.fn()
    const g = new SessionGatewayConsumer('redis://localhost:6379', onSessionInit)
    const p = g.start(); await new Promise(r => setTimeout(r, 50)); g.stop(); await p
    expect(onSessionInit).not.toHaveBeenCalled()
    expect(mockRedis.xadd.mock.calls[0]![0]).toBe('orchestrator:to-manager:sessions:dlq')
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('onSessionInit throw를 {stream}:dlq로 격리(handler_failed·재시도 없음)', async () => {
    const sid = '550e8400-e29b-41d4-a716-446655440000'
    const mockRedis = makeRedis([[['orchestrator:to-manager:sessions', [['8-1', ['data', JSON.stringify({ sessionId: sid })]]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const onSessionInit = vi.fn().mockRejectedValue(new Error('boom'))
    const g = new SessionGatewayConsumer('redis://localhost:6379', onSessionInit)
    const p = g.start(); await new Promise(r => setTimeout(r, 50)); g.stop(); await p
    expect(onSessionInit).toHaveBeenCalledTimes(1)
    expect(mockRedis.xadd.mock.calls[0]![0]).toBe('orchestrator:to-manager:sessions:dlq')
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('non-uuid sessionId를 {stream}:dlq로 격리(invalid_schema)', async () => {
    // 유일한 생산자가 UUID v4를 강제하므로 여기 도달 = 손상/주입. 무음 skip하지 않는다(M8).
    const mockRedis = makeRedis([[['orchestrator:to-manager:sessions', [['8-2', ['data', JSON.stringify({ sessionId: 'not-a-uuid' })]]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const onSessionInit = vi.fn()
    const g = new SessionGatewayConsumer('redis://localhost:6379', onSessionInit)
    const p = g.start(); await new Promise(r => setTimeout(r, 50)); g.stop(); await p
    expect(onSessionInit).not.toHaveBeenCalled()
    expect(mockRedis.xadd.mock.calls[0]![0]).toBe('orchestrator:to-manager:sessions:dlq')
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('data 필드 부재는 DLQ 없이 ack-skip하되 로그를 남긴다', async () => {
    // 페이로드가 없어 DLQ에 실을 것이 없다 — shared BaseConsumer와 같은 처리. 다만 무음은 아니다.
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const mockRedis = makeRedis([[['orchestrator:to-manager:sessions', [['8-3', ['other', 'x']]]]]])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
    const onSessionInit = vi.fn()
    const g = new SessionGatewayConsumer('redis://localhost:6379', onSessionInit)
    const p = g.start(); await new Promise(r => setTimeout(r, 50)); g.stop(); await p
    expect(onSessionInit).not.toHaveBeenCalled()
    expect(mockRedis.xadd).not.toHaveBeenCalled()
    expect(mockRedis.xack).toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('data 필드 없음'), '8-3')
    err.mockRestore()
  })
})

describe('SessionGatewayConsumer.isRunning', () => {
  it('기동에 성공하면 true, stop() 이후 false', async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeRedis() as never)
    const gateway = new SessionGatewayConsumer('redis://localhost:6379', vi.fn())

    expect(gateway.isRunning()).toBe(false)
    const p = gateway.start()
    await new Promise(r => setTimeout(r, 30))
    expect(gateway.isRunning()).toBe(true)
    gateway.stop()
    await p
    expect(gateway.isRunning()).toBe(false)
  })

  it('기동 시점에 Redis 가 죽어 있으면 영구히 false 다 — ping 은 나중에 PONG 을 준다', async () => {
    // 그룹 생성이 소비 루프 **밖**이라 여기서 throw 하면 `running` 이 영영 true 가
    // 되지 않는다. 그런데 ioredis 는 계속 재연결하므로 잠시 뒤 `ping()` 은 PONG 을
    // 준다 — Redis 프로브만으로는 이 상태를 못 잡는다. readiness 가 루프 상태를
    // 따로 노출해야 하는 이유가 이것이다.
    const redis = { ...makeRedis(), xgroup: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }
    vi.mocked(getRedisClient).mockReturnValue(redis as never)
    const gateway = new SessionGatewayConsumer('redis://localhost:6379', vi.fn())

    await expect(gateway.start()).rejects.toThrow('ECONNREFUSED')
    expect(gateway.isRunning()).toBe(false)
    expect(redis.xreadgroup).not.toHaveBeenCalled()
  })
})
