import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../streams/redis.client.js', () => ({ getRedisClient: vi.fn() }))

import { getRedisClient } from '../streams/redis.client.js'
import { z } from 'zod'
import { RedisAgentHandler } from './redis-agent-handler.js'
import { ClarificationNeededError, AgentQueryError } from './errors.js'
import { SESSION_STREAM_TTL_SEC } from '../streams/session-keys.js'
import { Bulkhead } from '@xzawed/agent-streams'

const getRedisClientMock = vi.mocked(getRedisClient)

const buildOutputSchema = z.object({
  success: z.boolean().default(false),
  output: z.string().default(''),
  artifacts: z.array(z.string()).default([]),
})

type MockRedis = {
  xrevrange: ReturnType<typeof vi.fn>
  xadd: ReturnType<typeof vi.fn>
  xread: ReturnType<typeof vi.fn>
  xgroup: ReturnType<typeof vi.fn>
  expire: ReturnType<typeof vi.fn>
  persist: ReturnType<typeof vi.fn>
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return [['builder:to-manager:sess-1', [['2-0', ['data', JSON.stringify({ type, payload })]]]]]
}

let mockRedis: MockRedis
let handler: RedisAgentHandler<Record<string, unknown>, z.infer<typeof buildOutputSchema>>

beforeEach(() => {
  vi.resetAllMocks()
  mockRedis = {
    xrevrange: vi.fn().mockResolvedValue([]),
    xadd: vi.fn().mockResolvedValue('1-0'),
    xread: vi.fn().mockResolvedValue(null),
    xgroup: vi.fn().mockResolvedValue('OK'),
    expire: vi.fn().mockResolvedValue(1),
    persist: vi.fn().mockResolvedValue(1),
  }
  getRedisClientMock.mockReturnValue(mockRedis as unknown as ReturnType<typeof getRedisClient>)
  handler = new RedisAgentHandler(
    'redis://localhost:6379',
    'builder',
    'build_request',
    'build_complete',
    'build_project',
    'Build the project',
    { type: 'object', properties: {}, required: [] },
    buildOutputSchema,
  )
})

describe('RedisAgentHandler', () => {
  it('build_complete 수신 시 파싱된 output을 반환한다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: 'Build OK', artifacts: ['dist/app.js'] })
    )
    const result = await handler.execute({ projectPath: '/app', target: 'production', context: {} }, 'sess-1')
    expect(result.success).toBe(true)
    expect(result.output).toBe('Build OK')
    expect(result.artifacts).toEqual(['dist/app.js'])
  })

  it('error 수신 시 에러를 던진다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('error', { content: '빌드 실패' })
    )
    await expect(handler.execute({}, 'sess-1')).rejects.toThrow('빌드 실패')
  })

  it('info_request 수신 시 Clarification 에러를 던진다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('info_request', { content: '프레임워크를 선택해 주세요' })
    )
    const err = await handler.execute({}, 'sess-1').catch(e => e)
    expect(err).toBeInstanceOf(ClarificationNeededError)
    expect(err.content).toBe('프레임워크를 선택해 주세요')
  })

  it('agent_query 수신 시 AgentQueryError를 던진다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('agent_query', { to: 'developer', question: '재고 표시 가능?', kind: 'active_request' })
    )
    const err = await handler.execute({}, 'sess-1').catch(e => e)
    expect(err).toBeInstanceOf(AgentQueryError)
    expect(err.to).toBe('developer')
    expect(err.question).toBe('재고 표시 가능?')
    expect(err.kind).toBe('active_request')
  })

  it('build_progress를 무시하고 build_complete를 기다린다', async () => {
    mockRedis.xread
      .mockResolvedValueOnce(makeMsg('build_progress', { content: '50%' }))
      .mockResolvedValueOnce(makeMsg('build_complete', { success: true, output: 'done', artifacts: [] }))
    const result = await handler.execute({}, 'sess-1')
    expect(result.success).toBe(true)
    expect(mockRedis.xread).toHaveBeenCalledTimes(2)
  })

  it('퍼세션 스트림에 XADD한다 (manager:to-{agent}:{sessionId})', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] })
    )
    await handler.execute({ projectPath: '/app' }, 'sess-42')
    expect(mockRedis.xadd).toHaveBeenCalledWith(
      'manager:to-builder:sess-42', '*', 'data', expect.stringContaining('"type":"build_request"')
    )
  })

  it('userContext가 있으면 payload에 포함하여 XADD한다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] })
    )
    const userContext = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/u1/p1' }
    await handler.execute({ projectPath: '/app' }, 'sess-42', userContext)
    // calls[0] is the gateway notification xadd; calls[1] is the request xadd
    const call = mockRedis.xadd.mock.calls[1] as unknown[]
    const data = JSON.parse(call[3] as string) as { payload: Record<string, unknown> }
    expect(data.payload['userContext']).toEqual(userContext)
  })

  it('payload에 optional 필드가 없어도 Zod default로 채운다', async () => {
    mockRedis.xread.mockResolvedValueOnce(makeMsg('build_complete', {}))
    const result = await handler.execute({}, 'sess-1')
    expect(result.success).toBe(false)
    expect(result.output).toBe('')
    expect(result.artifacts).toEqual([])
  })

  it('xrevrange로 응답 스트림 tip을 먼저 조회한다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] })
    )
    await handler.execute({}, 'sess-1')
    expect(mockRedis.xrevrange).toHaveBeenCalledWith('builder:to-manager:sess-1', '+', '-', 'COUNT', '1')
    // calls[0] is gateway notification xadd, calls[1] is the request publishRequest xadd
    // xrevrange must happen before publishRequest (the last xadd call)
    const xaddCalls = mockRedis.xadd.mock.invocationCallOrder as number[]
    const publishRequestOrder = xaddCalls[xaddCalls.length - 1]!
    expect(mockRedis.xrevrange.mock.invocationCallOrder[0]).toBeLessThan(publishRequestOrder)
  })

  it('타임아웃 시 에러를 던진다', async () => {
    const shortHandler = new RedisAgentHandler(
      'redis://localhost:6379',
      'builder',
      'build_request',
      'build_complete',
      'build_project',
      'test',
      { type: 'object', properties: {}, required: [] },
      buildOutputSchema,
      100, // 100ms timeout
    )
    mockRedis.xread.mockResolvedValue(null)
    await expect(shortHandler.execute({}, 'sess-1')).rejects.toThrow('timed out')
  })

  it('execute 전에 xgroup CREATE로 컨슈머 그룹을 생성한다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] })
    )
    await handler.execute({}, 'sess-1')
    expect(mockRedis.xgroup).toHaveBeenCalledWith(
      'CREATE', 'manager:to-builder:sess-1', 'builder-consumers', '$', 'MKSTREAM'
    )
    expect(mockRedis.xgroup.mock.invocationCallOrder[0]).toBeLessThan(
      mockRedis.xadd.mock.invocationCallOrder[0]
    )
  })

  it('같은 agent+session 조합에서 xgroup은 최초 1회만 호출한다', async () => {
    mockRedis.xread
      .mockResolvedValueOnce(makeMsg('build_complete', { success: true, output: '', artifacts: [] }))
      .mockResolvedValueOnce(makeMsg('build_complete', { success: true, output: '', artifacts: [] }))

    await handler.execute({}, 'sess-1')
    await handler.execute({}, 'sess-1')

    const xgroupCallsForSess1 = mockRedis.xgroup.mock.calls.filter(
      (c: unknown[]) => c[1] === 'manager:to-builder:sess-1'
    )
    expect(xgroupCallsForSess1).toHaveLength(1)
  })

  it('게이트웨이 스트림에 세션 알림을 발행한다 (최초 1회)', async () => {
    mockRedis.xread
      .mockResolvedValueOnce(makeMsg('build_complete', { success: true, output: '', artifacts: [] }))
      .mockResolvedValueOnce(makeMsg('build_complete', { success: true, output: '', artifacts: [] }))

    await handler.execute({}, 'sess-new')
    await handler.execute({}, 'sess-new')

    const gatewayCalls = (mockRedis.xadd.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'manager:to-builder:sessions'
    )
    expect(gatewayCalls).toHaveLength(1)
    const data = JSON.parse(gatewayCalls[0]![3] as string) as { sessionId: string }
    expect(data.sessionId).toBe('sess-new')
  })

  it('BUSYGROUP 에러는 무시하고 계속 진행한다', async () => {
    mockRedis.xgroup.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'))
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] })
    )
    await expect(handler.execute({}, 'sess-existing')).resolves.toBeDefined()
  })

  describe('close', () => {
    it('execute 없이 close() — 예외 없음 (redis 미초기화)', async () => {
      await expect(handler.close()).resolves.toBeUndefined()
    })

    it('execute 후 close() — _notifiedSessions를 정리하고 예외 없음', async () => {
      mockRedis.xread.mockResolvedValueOnce(
        makeMsg('build_complete', { success: true, output: '', artifacts: [] })
      )
      await handler.execute({}, 'sess-1')
      await expect(handler.close()).resolves.toBeUndefined()
      // After close, the same session should trigger gateway notification again (session cleared)
      mockRedis.xread.mockResolvedValueOnce(
        makeMsg('build_complete', { success: true, output: '', artifacts: [] })
      )
      await handler.execute({}, 'sess-1')
      const gatewayCalls = (mockRedis.xadd.mock.calls as unknown[][]).filter(
        (c) => c[0] === 'manager:to-builder:sessions'
      )
      expect(gatewayCalls).toHaveLength(2)
    })
  })

  describe('§13 벌크헤드 통합', () => {
    function buildOk() {
      return makeMsg('build_complete', { success: true, output: 'ok', artifacts: [] })
    }
    function handlerWith(bulkhead: Bulkhead) {
      return new RedisAgentHandler(
        'redis://localhost:6379', 'builder', 'build_request', 'build_complete', 'build_project',
        'Build the project', { type: 'object', properties: {}, required: [] }, buildOutputSchema,
        undefined, bulkhead,
      )
    }

    it('bulkhead 주입 시 agentName 키로 bulkhead.run을 통해 실행한다', async () => {
      mockRedis.xread.mockResolvedValueOnce(buildOk())
      const run = vi.fn((_key: string, fn: () => Promise<unknown>) => fn())
      const h = handlerWith({ run } as unknown as Bulkhead)
      const result = await h.execute({ projectPath: '/app', target: 'production', context: {} }, 'sess-1')
      expect(run).toHaveBeenCalledWith('builder', expect.any(Function))
      expect((result as { success: boolean }).success).toBe(true)
    })

    it('실 Bulkhead로 감싸도 정상 반환하고 슬롯을 해제한다', async () => {
      mockRedis.xread.mockResolvedValueOnce(buildOk())
      const bulkhead = new Bulkhead({ perKeyLimit: 1 })
      const h = handlerWith(bulkhead)
      await h.execute({ projectPath: '/app', target: 'production', context: {} }, 'sess-1')
      expect(bulkhead.snapshot().global).toBe(0) // 완료 후 해제
    })

    it('bulkhead 미주입이면 직접 실행한다(회귀 0)', async () => {
      mockRedis.xread.mockResolvedValueOnce(buildOk())
      const result = await handler.execute({}, 'sess-1') // beforeEach 핸들러(bulkhead 미주입)
      expect((result as { success: boolean }).success).toBe(true)
    })
  })
})

describe('RedisAgentHandler — 세션 종료 통지 (5-B)', () => {
  const gatewayOf = () => (mockRedis.xadd.mock.calls as unknown[][]).filter(
    (c) => c[0] === 'manager:to-builder:sessions',
  )
  const payloadOf = (call: unknown[]) => JSON.parse(call[3] as string) as Record<string, unknown>

  it('T7 — 통지 이력이 있을 때만 end를 발행한다', async () => {
    // 통지한 적 없음 → 발행 0건
    await handler.releaseSession('never-notified')
    expect(gatewayOf()).toHaveLength(0)

    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute({}, 'sess-1')
    expect(gatewayOf()).toHaveLength(1)

    await handler.releaseSession('sess-1')
    const calls = gatewayOf()
    expect(calls).toHaveLength(2)
    expect(payloadOf(calls[1]!)).toEqual({
      event: 'end', endSessionId: 'sess-1', timestamp: expect.any(Number),
    })
  })

  it('end 페이로드에 sessionId 키가 없다 — 구 디스패처가 시작으로 오독하면 안 된다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute({}, 'sess-1')
    await handler.releaseSession('sess-1')

    const end = payloadOf(gatewayOf()[1]!)
    expect(end).not.toHaveProperty('sessionId')
  })

  it('시작 통지에는 event 키가 없다 — 기존 형태를 바꾸지 않는다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute({}, 'sess-1')

    const start = payloadOf(gatewayOf()[0]!)
    expect(start).not.toHaveProperty('event')
    expect(start['sessionId']).toBe('sess-1')
  })

  it('T8 — end 발행이 memo 삭제보다 먼저 일어난다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute({}, 'sess-1')

    const order: string[] = []
    mockRedis.xadd.mockImplementationOnce(async (...args: unknown[]) => {
      order.push('end-published')
      // 발행이 진행 중인 동안 재통지가 끼어들 수 있는지 관측한다.
      const p = JSON.parse(args[3] as string) as { event?: string }
      expect(p.event).toBe('end')
      return '1-0'
    })

    await handler.releaseSession('sess-1')
    order.push('memo-cleared')

    // 발행 후 재통지가 가능해야 한다(memo가 실제로 비워졌다).
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute({}, 'sess-1')

    expect(order).toEqual(['end-published', 'memo-cleared'])
    expect(gatewayOf()).toHaveLength(3) // start · end · 재start
  })

  it('end 발행 실패는 삼키고 세션 정리를 계속한다 (never-throw)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute({}, 'sess-1')

    mockRedis.xadd.mockRejectedValueOnce(new Error('redis down'))
    await expect(handler.releaseSession('sess-1')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()

    // 실패해도 memo는 비워진다 — 안 그러면 그 세션이 영구히 재통지 불가가 된다.
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute({}, 'sess-1')
    expect(gatewayOf().filter((c) => !('event' in payloadOf(c)))).toHaveLength(2)
    spy.mockRestore()
  })

  it('T9 — RPC 타임아웃 후 재호출이 게이트웨이를 재통지한다', async () => {
    const fast = new RedisAgentHandler(
      'redis://localhost:6379', 'builder', 'build_request', 'build_complete',
      'build_project', 'Build the project',
      { type: 'object', properties: {}, required: [] }, buildOutputSchema,
      10, // timeoutMs — 9번째 인자
    )
    mockRedis.xread.mockResolvedValue(null) // 응답 없음 → 타임아웃

    await expect(fast.execute({}, 'sess-timeout')).rejects.toThrow(/timed out/)
    await expect(fast.execute({}, 'sess-timeout')).rejects.toThrow(/timed out/)

    // 타임아웃이 memo를 풀지 않으면 두 번째 호출은 재통지하지 않아 1건에 머문다.
    const starts = (mockRedis.xadd.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'manager:to-builder:sessions' && !('event' in payloadOf(c)),
    )
    expect(starts).toHaveLength(2)
  })
})

describe('RedisAgentHandler — LLM이 userContext를 공급하지 못한다 (6-B)', () => {
  const UC = { userId: 'u', projectId: 'p', workspaceRoot: '/legit' }
  const requestOf = () => (mockRedis.xadd.mock.calls as unknown[][]).filter(
    (c) => String(c[0]).startsWith('manager:to-builder:') && !String(c[0]).endsWith(':sessions'),
  )
  const payloadOf = (call: unknown[]) =>
    (JSON.parse(call[3] as string) as { payload: Record<string, unknown> }).payload

  it('서버 userContext가 있으면 도구 입력의 동명 필드를 덮어쓴다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute(
      { plan: 'x', userContext: { userId: 'evil', projectId: 'e', workspaceRoot: '/etc' } } as never,
      'sess-1',
      UC as never,
    )
    expect(payloadOf(requestOf()[0]!)['userContext']).toEqual(UC)
  })

  it('서버 userContext가 없으면 도구 입력의 userContext를 벗겨낸다', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    // watcher file_changed發 task_request 경로가 이 상태다 — userContext가 아예 없다.
    await handler.execute(
      { plan: 'x', userContext: { userId: 'evil', projectId: 'e', workspaceRoot: '/etc' } } as never,
      'sess-1',
    )
    const p = payloadOf(requestOf()[0]!)
    expect(p).not.toHaveProperty('userContext')
    expect(p['plan']).toBe('x')
  })

  it('userContext가 없는 정상 입력은 그대로 전달한다 — 과잉 차단 금지', async () => {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute({ plan: 'x', projectPath: '/w', context: {} } as never, 'sess-1')
    const p = payloadOf(requestOf()[0]!)
    expect(p).toEqual({ plan: 'x', projectPath: '/w', context: {} })
  })
})

/**
 * **세션 스트림 키 회수.** 스트림 키는 세션마다 새로 생기는데 회수 코드가 0줄이었다.
 * 출하 스택은 `noeviction` 384MB 라 상한에 닿으면 모든 XADD 가 영구 실패한다
 * (실측: 실제 세션 161,610 B → 2,484 세션에 도달).
 */
describe('RedisAgentHandler — 세션 스트림 키 수명', () => {
  const keys = ['manager:to-builder:sess-1', 'builder:to-manager:sess-1']

  async function notifyOnce(): Promise<void> {
    mockRedis.xread.mockResolvedValueOnce(
      makeMsg('build_complete', { success: true, output: '', artifacts: [] }),
    )
    await handler.execute({}, 'sess-1')
  }

  it('세션 종료 시 이 핸들러가 만든 스트림 쌍에 TTL 을 건다', async () => {
    await notifyOnce()
    expect(mockRedis.expire).not.toHaveBeenCalled()

    await handler.releaseSession('sess-1')
    const expired = (mockRedis.expire.mock.calls as unknown[][]).map((c) => c[0])
    expect(expired.sort()).toEqual([...keys].sort())
    for (const call of mockRedis.expire.mock.calls as unknown[][]) {
      expect(call[1]).toBe(SESSION_STREAM_TTL_SEC)
    }
  })

  /** 통지가 실패한 세션일수록 키가 남는다 — 통지 성패와 무관하게 회수해야 한다. */
  it('종료 통지가 실패해도 TTL 은 건다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await notifyOnce()
    mockRedis.xadd.mockRejectedValueOnce(new Error('redis down'))

    await expect(handler.releaseSession('sess-1')).resolves.toBeUndefined()
    expect(mockRedis.expire).toHaveBeenCalledTimes(keys.length)
  })

  it('통지 이력이 없으면 회수도 하지 않는다(조기 반환)', async () => {
    await handler.releaseSession('never-notified')
    expect(mockRedis.expire).not.toHaveBeenCalled()
  })

  /**
   * **이게 없으면 재개된 세션의 스트림이 도중에 증발한다.**
   * 실측: `XADD` 도 `XGROUP CREATE` 도 TTL 을 지우지 않는다(600 → 599).
   */
  it('세션 재개 시 TTL 을 벗긴다(PERSIST)', async () => {
    await notifyOnce()
    const persisted = (mockRedis.persist.mock.calls as unknown[][]).map((c) => c[0])
    expect(persisted.sort()).toEqual([...keys].sort())
  })

  it('종료 후 같은 sessionId 로 재개하면 다시 PERSIST 한다', async () => {
    await notifyOnce()
    await handler.releaseSession('sess-1')
    mockRedis.persist.mockClear()

    await notifyOnce()
    expect((mockRedis.persist.mock.calls as unknown[][]).map((c) => c[0]).sort()).toEqual([...keys].sort())
  })
})
