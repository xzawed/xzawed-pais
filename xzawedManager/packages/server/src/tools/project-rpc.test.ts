import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('../streams/redis.client.js', () => ({ getRedisClient: vi.fn() }))

import { getRedisClient } from '../streams/redis.client.js'
import { createRegisterProjectHandler } from './register-project.js'
import { createSwitchProjectHandler } from './switch-project.js'

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeRedis(responsePayload: unknown, responseType: string) {
  return {
    xrevrange: vi.fn().mockResolvedValue([]),
    xadd: vi.fn().mockResolvedValue('1-0'),
    xread: vi.fn().mockResolvedValueOnce([
      [`orchestrator:to-manager:projects:${SESSION_ID}`, [
        ['2-0', ['data', JSON.stringify({
          type: responseType,
          sessionId: SESSION_ID,
          messageId: 'resp-1',
          timestamp: Date.now(),
          payload: responsePayload,
        })]]
      ]]
    ]).mockResolvedValue(null),
  }
}

afterEach(() => vi.clearAllMocks())

describe('register_project Redis RPC', () => {
  it('요청을 발행하고 응답을 반환한다', async () => {
    const expected = { projectId: 'proj-1', workspacePath: '/tmp/p', status: 'registered' }
    const mockRedis = makeRedis(expected, 'register_project_response')
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const handler = createRegisterProjectHandler('redis://localhost:6379')
    const result = await handler.execute({ name: 'myproject', workspaceType: 'local', localPath: '/tmp/p' }, SESSION_ID)

    expect(result).toEqual(expected)
    expect(mockRedis.xadd).toHaveBeenCalledWith(
      'manager:to-orchestrator:projects',
      '*',
      'data',
      expect.stringContaining('"type":"register_project_request"'),
    )
  })

  it('project_error 응답 시 예외를 던진다', async () => {
    const mockRedis = makeRedis({ error: 'DB error', requestType: 'register_project_request' }, 'project_error')
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const handler = createRegisterProjectHandler('redis://localhost:6379')
    await expect(handler.execute({ name: 'bad', workspaceType: 'local' }, SESSION_ID))
      .rejects.toThrow('DB error')
  })
})

describe('switch_project Redis RPC', () => {
  it('요청을 발행하고 응답을 반환한다', async () => {
    const expected = { projectId: 'proj-2', name: 'myproject', workspacePath: null }
    const mockRedis = makeRedis(expected, 'switch_project_response')
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const handler = createSwitchProjectHandler('redis://localhost:6379')
    const result = await handler.execute({ name: 'myproject' }, SESSION_ID)

    expect(result).toEqual(expected)
  })
})
