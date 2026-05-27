import { vi, describe, it, expect, afterEach } from 'vitest'
import type { Redis } from 'ioredis'
import { SessionDispatcher } from '../streams/session-dispatcher.js'

function makeGatewayRedis(xreadgroupBatches: unknown[][] = []) {
  let call = 0
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockImplementation(async () => {
      if (call >= xreadgroupBatches.length) return null
      return xreadgroupBatches[call++]
    }),
    xack: vi.fn().mockResolvedValue(1),
  } as unknown as Redis
}

afterEach(() => vi.clearAllMocks())

describe('SessionDispatcher', () => {
  it('게이트웨이에서 sessionId 수신 시 factory를 호출하고 consumer.start()를 실행한다', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const gatewayRedis = makeGatewayRedis([
      [['manager:to-planner:sessions', [['1-0', ['data', JSON.stringify({ sessionId })]]]]]
    ])

    const consumerStart = vi.fn().mockResolvedValue(undefined)
    const consumerStop = vi.fn()
    const factory = vi.fn().mockReturnValue({ start: consumerStart, stop: consumerStop })

    const dispatcher = new SessionDispatcher(
      gatewayRedis,
      'manager:to-planner:sessions',
      'planner-session-dispatcher',
      factory,
    )

    const p = dispatcher.start()
    await new Promise(r => setTimeout(r, 50))
    dispatcher.stop()
    await p

    expect(factory).toHaveBeenCalledWith(sessionId)
    expect(consumerStart).toHaveBeenCalledWith(sessionId)
  })

  it('동일 sessionId가 두 번 도착해도 consumer를 중복 생성하지 않는다', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const entry = ['1-0', ['data', JSON.stringify({ sessionId })]]
    const gatewayRedis = makeGatewayRedis([
      [['manager:to-planner:sessions', [entry, entry]]]
    ])

    const factory = vi.fn().mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    })

    const dispatcher = new SessionDispatcher(
      gatewayRedis,
      'manager:to-planner:sessions',
      'planner-session-dispatcher',
      factory,
    )

    const p = dispatcher.start()
    await new Promise(r => setTimeout(r, 50))
    dispatcher.stop()
    await p

    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('stop() 호출 시 모든 활성 consumer를 중단한다', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const gatewayRedis = makeGatewayRedis([
      [['manager:to-planner:sessions', [['1-0', ['data', JSON.stringify({ sessionId })]]]]]
    ])

    const consumerStop = vi.fn()
    const factory = vi.fn().mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: consumerStop,
    })

    const dispatcher = new SessionDispatcher(
      gatewayRedis,
      'manager:to-planner:sessions',
      'planner-session-dispatcher',
      factory,
    )

    const p = dispatcher.start()
    await new Promise(r => setTimeout(r, 50))
    dispatcher.stop()
    await p

    expect(consumerStop).toHaveBeenCalled()
  })

  it('stop() 호출 시 close()를 구현한 consumer의 close()를 호출한다', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const gatewayRedis = makeGatewayRedis([
      [['manager:to-planner:sessions', [['1-0', ['data', JSON.stringify({ sessionId })]]]]]
    ])

    const consumerClose = vi.fn().mockResolvedValue(undefined)
    const factory = vi.fn().mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      close: consumerClose,
    })

    const dispatcher = new SessionDispatcher(
      gatewayRedis,
      'manager:to-planner:sessions',
      'planner-session-dispatcher',
      factory,
    )

    const p = dispatcher.start()
    await new Promise(r => setTimeout(r, 50))
    dispatcher.stop()
    await p

    expect(consumerClose).toHaveBeenCalled()
  })

  it('close() 호출 시 모든 consumer의 close()를 await한다', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const gatewayRedis = makeGatewayRedis([
      [['manager:to-planner:sessions', [['1-0', ['data', JSON.stringify({ sessionId })]]]]]
    ])

    const consumerClose = vi.fn().mockResolvedValue(undefined)
    const factory = vi.fn().mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      close: consumerClose,
    })

    const dispatcher = new SessionDispatcher(
      gatewayRedis,
      'manager:to-planner:sessions',
      'planner-session-dispatcher',
      factory,
    )

    const p = dispatcher.start()
    await new Promise(r => setTimeout(r, 50))
    await dispatcher.close()
    await p.catch(() => undefined)

    expect(consumerClose).toHaveBeenCalled()
  })

  it('BUSYGROUP 에러는 무시한다', async () => {
    const gatewayRedis = makeGatewayRedis([])
    ;(gatewayRedis as unknown as { xgroup: ReturnType<typeof vi.fn> }).xgroup
      .mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'))

    const dispatcher = new SessionDispatcher(
      gatewayRedis,
      'manager:to-planner:sessions',
      'planner-session-dispatcher',
      vi.fn().mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
    )

    const p = dispatcher.start()
    await new Promise(r => setTimeout(r, 50))
    dispatcher.stop()
    await expect(p).resolves.toBeUndefined()
  })
})
