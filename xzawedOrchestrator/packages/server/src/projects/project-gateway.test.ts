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

describe('ProjectGatewayConsumer.isRunning', () => {
  it('기동에 성공하면 true, stop() 이후 false', async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeRedis() as never)
    const gateway = new ProjectGatewayConsumer('redis://localhost:6379', vi.fn(), vi.fn())

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
    const gateway = new ProjectGatewayConsumer('redis://localhost:6379', vi.fn(), vi.fn())

    await expect(gateway.start()).rejects.toThrow('ECONNREFUSED')
    expect(gateway.isRunning()).toBe(false)
    expect(redis.xreadgroup).not.toHaveBeenCalled()
  })
})
