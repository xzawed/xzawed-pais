import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('../streams/redis.client.js', () => ({
  getRedisClient: vi.fn(),
}))

import { getRedisClient } from '../streams/redis.client.js'
import { SessionGatewayConsumer } from './session-gateway.js'

function makeRedis(xreadgroupResults: unknown[][] = []) {
  let callCount = 0
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockImplementation(async () => {
      if (callCount >= xreadgroupResults.length) return null
      return xreadgroupResults[callCount++]
    }),
    xack: vi.fn().mockResolvedValue(1),
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
})
