import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('../streams/redis.client.js', () => ({ getRedisClient: vi.fn() }))

import { getRedisClient } from '../streams/redis.client.js'
import { ProjectGatewayConsumer } from './project-gateway.js'

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeRedis(responses: unknown[][] = []) {
  let call = 0
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockImplementation(() => {
      if (call >= responses.length) {
        // Simulate BLOCK timeout — yield to macrotask queue so stop()/setTimeout can fire
        return new Promise<null>(r => setImmediate(() => r(null)))
      }
      return Promise.resolve(responses[call++])
    }),
    xack: vi.fn().mockResolvedValue(1),
    xadd: vi.fn().mockResolvedValue('1-0'),
  }
}

afterEach(() => vi.clearAllMocks())

describe('ProjectGatewayConsumer', () => {
  it('register_project 요청을 처리하고 응답을 발행한다', async () => {
    const request = {
      type: 'register_project_request',
      sessionId: SESSION_ID,
      messageId: 'msg-1',
      timestamp: Date.now(),
      payload: { name: 'test', workspaceType: 'local', localPath: '/tmp/test' },
    }
    const mockRedis = makeRedis([
      [['manager:to-orchestrator:projects', [['1-0', ['data', JSON.stringify(request)]]]]]
    ])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const mockHandler = vi.fn().mockResolvedValue({ projectId: 'proj-1', workspacePath: '/tmp/test', status: 'registered' })
    const gateway = new ProjectGatewayConsumer('redis://localhost:6379', mockHandler, vi.fn())

    const p = gateway.start()
    await new Promise(r => setTimeout(r, 50))
    gateway.stop()
    await p

    expect(mockHandler).toHaveBeenCalledWith(SESSION_ID, request.payload)
    expect(mockRedis.xadd).toHaveBeenCalledWith(
      `orchestrator:to-manager:projects:${SESSION_ID}`,
      '*',
      'data',
      expect.stringContaining('"type":"register_project_response"'),
    )
  })

  it('switch_project 요청을 처리하고 응답을 발행한다', async () => {
    const request = {
      type: 'switch_project_request',
      sessionId: SESSION_ID,
      messageId: 'msg-3',
      timestamp: Date.now(),
      payload: { name: 'myproject' },
    }
    const mockRedis = makeRedis([
      [['manager:to-orchestrator:projects', [['3-0', ['data', JSON.stringify(request)]]]]]
    ])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const expectedResult = { projectId: 'proj-1', name: 'myproject', workspacePath: '/tmp/proj' }
    const mockSwitchHandler = vi.fn().mockResolvedValue(expectedResult)
    const gateway = new ProjectGatewayConsumer('redis://localhost:6379', vi.fn(), mockSwitchHandler)

    const p = gateway.start()
    await new Promise(r => setTimeout(r, 50))
    gateway.stop()
    await p

    expect(mockSwitchHandler).toHaveBeenCalledWith(SESSION_ID, request.payload)
    expect(mockRedis.xadd).toHaveBeenCalledWith(
      `orchestrator:to-manager:projects:${SESSION_ID}`,
      '*',
      'data',
      expect.stringContaining('"type":"switch_project_response"'),
    )
  })

  it('잘못된 JSON은 xack 후 스킵한다', async () => {
    const mockRedis = makeRedis([
      [['manager:to-orchestrator:projects', [['4-0', ['data', 'not-json']]]]]
    ])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const gateway = new ProjectGatewayConsumer('redis://localhost:6379', vi.fn(), vi.fn())

    const p = gateway.start()
    await new Promise(r => setTimeout(r, 50))
    gateway.stop()
    await p

    // xack was called even for malformed JSON
    expect(mockRedis.xack).toHaveBeenCalled()
  })

  it('핸들러 예외 시 error 타입으로 응답한다', async () => {
    const request = {
      type: 'register_project_request',
      sessionId: SESSION_ID,
      messageId: 'msg-2',
      timestamp: Date.now(),
      payload: { name: 'bad', workspaceType: 'local' },
    }
    const mockRedis = makeRedis([
      [['manager:to-orchestrator:projects', [['2-0', ['data', JSON.stringify(request)]]]]]
    ])
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const mockHandler = vi.fn().mockRejectedValue(new Error('DB error'))
    const gateway = new ProjectGatewayConsumer('redis://localhost:6379', mockHandler, vi.fn())

    const p = gateway.start()
    await new Promise(r => setTimeout(r, 50))
    gateway.stop()
    await p

    expect(mockRedis.xadd).toHaveBeenCalledWith(
      `orchestrator:to-manager:projects:${SESSION_ID}`,
      '*',
      'data',
      expect.stringContaining('"type":"project_error"'),
    )
  })
})

/**
 * `start()` 는 `xgroup CREATE` 를 직접 부르고 BUSYGROUP 만 삼킨다. 그 분기가 루프
 * **밖**이라, 삼키느냐 던지느냐가 그대로 `isRunning()` 의 값이 된다.
 */
describe('ProjectGatewayConsumer.isRunning', () => {
  const start = async (xgroup: ReturnType<typeof vi.fn>) => {
    const redis = { ...makeRedis(), xgroup }
    vi.mocked(getRedisClient).mockReturnValue(redis as never)
    const gateway = new ProjectGatewayConsumer('redis://localhost:6379', vi.fn(), vi.fn())
    return { redis, gateway, running: () => gateway.isRunning() }
  }

  it('그룹이 이미 있으면(BUSYGROUP) 삼키고 정상 기동한다', async () => {
    const { gateway, running } = await start(vi.fn().mockRejectedValue(new Error('BUSYGROUP already exists')))
    expect(running()).toBe(false)
    const p = gateway.start()
    await new Promise(r => setTimeout(r, 30))
    expect(running()).toBe(true)
    gateway.stop()
    await p
    expect(running()).toBe(false)
  })

  it('BUSYGROUP 이 아닌 오류는 전파되고 루프는 영영 돌지 않는다', async () => {
    // ioredis 재연결은 계속되므로 잠시 뒤 `ping()` 은 PONG 을 준다 — Redis 프로브만
    // 보는 readiness 는 이 죽은 게이트웨이를 ready 로 답한다.
    const { redis, gateway, running } = await start(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(gateway.start()).rejects.toThrow('ECONNREFUSED')
    expect(running()).toBe(false)
    expect(redis.xreadgroup).not.toHaveBeenCalled()
  })
})
