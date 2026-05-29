import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../streams/redis.client.js', () => ({ getRedisClient: vi.fn() }))

import { getRedisClient } from '../streams/redis.client.js'
import { z } from 'zod'
import { RedisAgentHandler } from './redis-agent-handler.js'
import { ClarificationNeededError } from './errors.js'

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
})
