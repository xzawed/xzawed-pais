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

    // xack 사이에 마이크로태스크가 처리되므로 start()가 즉시 완료되면
    // pendingConsumers/activeConsumers 가드가 해제될 수 있다.
    // 실제 consumer.start()는 무한 루프이므로 stop() 전까지 완료되지 않는다.
    let resolveStart!: () => void
    const factory = vi.fn().mockReturnValue({
      start: vi.fn().mockReturnValue(new Promise<void>(r => { resolveStart = r })),
      stop: vi.fn().mockImplementation(() => { resolveStart?.() }),
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
    // 실제 consumer.start()는 무한 루프라 stop()이 호출되기 전까지 완료되지 않는다.
    // 테스트에서도 dispatcher.stop() 호출 전까지 완료되지 않도록 pending promise를 사용한다.
    let resolveStart!: () => void
    const factory = vi.fn().mockReturnValue({
      start: vi.fn().mockReturnValue(new Promise<void>(r => { resolveStart = r })),
      stop: vi.fn().mockImplementation(() => { consumerStop(); resolveStart?.() }),
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
    let resolveStart!: () => void
    const factory = vi.fn().mockReturnValue({
      start: vi.fn().mockReturnValue(new Promise<void>(r => { resolveStart = r })),
      stop: vi.fn().mockImplementation(() => { resolveStart?.() }),
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
    let resolveStart!: () => void
    const factory = vi.fn().mockReturnValue({
      start: vi.fn().mockReturnValue(new Promise<void>(r => { resolveStart = r })),
      stop: vi.fn().mockImplementation(() => { resolveStart?.() }),
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

  it('동일 sessionId에 대해 handleSessionEntry 동시 호출 시 consumer를 1개만 생성한다', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const gatewayRedis = makeGatewayRedis([])

    let resolveStart!: () => void
    const startPromise = new Promise<void>(r => { resolveStart = r })
    const consumerStart = vi.fn().mockReturnValue(startPromise)
    const factory = vi.fn().mockReturnValue({ start: consumerStart, stop: vi.fn() })

    const dispatcher = new SessionDispatcher(
      gatewayRedis,
      'manager:to-planner:sessions',
      'planner-session-dispatcher',
      factory,
    )

    // 두 개 동시 진입 — pendingConsumers 가드가 두 번째 진입을 차단해야 한다
    const p1 = (dispatcher as unknown as { handleSessionEntry(id: string): Promise<void> }).handleSessionEntry(sessionId)
    const p2 = (dispatcher as unknown as { handleSessionEntry(id: string): Promise<void> }).handleSessionEntry(sessionId)

    resolveStart()
    await Promise.all([p1, p2])

    expect(factory).toHaveBeenCalledTimes(1)
    expect(consumerStart).toHaveBeenCalledTimes(1)
  })

  it('max active consumers 한도 초과 시 새 consumer를 추가하지 않는다', async () => {
    const sessionId1 = '550e8400-e29b-41d4-a716-446655440001'
    const sessionId2 = '550e8400-e29b-41d4-a716-446655440002'
    const sessionId3 = '550e8400-e29b-41d4-a716-446655440003'

    const entries = [
      ['1-0', ['data', JSON.stringify({ sessionId: sessionId1 })]],
      ['1-1', ['data', JSON.stringify({ sessionId: sessionId2 })]],
      ['1-2', ['data', JSON.stringify({ sessionId: sessionId3 })]],
    ]
    const gatewayRedis = makeGatewayRedis([
      [['manager:to-planner:sessions', entries]]
    ])

    const factory = vi.fn().mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    })

    // MAX_ACTIVE_CONSUMERS를 2로 줄이기 위해 activeConsumers를 직접 조작
    const dispatcher = new SessionDispatcher(
      gatewayRedis,
      'manager:to-planner:sessions',
      'planner-session-dispatcher',
      factory,
    )
    // private 필드에 접근하여 한도를 채운다
    const existing = (dispatcher as unknown as { activeConsumers: Map<string, unknown> }).activeConsumers
    for (let i = 0; i < 1000; i++) {
      existing.set(`prefilled-session-${i}`, { start: vi.fn(), stop: vi.fn() })
    }

    const p = dispatcher.start()
    await new Promise(r => setTimeout(r, 50))
    dispatcher.stop()
    await p

    // 이미 1000개가 채워져 있으므로 factory가 호출되지 않아야 함
    expect(factory).not.toHaveBeenCalled()
  })
})
