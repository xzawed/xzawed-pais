import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('../../streams/redis.client.js', () => ({ getRedisClient: vi.fn() }))

import { getRedisClient } from '../../streams/redis.client.js'
import { createRegisterProjectHandler } from '../register-project.js'

const SESSION_ID = 'session-1'

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

describe('register_project tool', () => {
  it('로컬 프로젝트 등록 시 Redis RPC 요청 발행 및 응답 반환', async () => {
    const expected = { projectId: 'proj-1', workspacePath: '/home/user/app', status: 'registered' }
    const mockRedis = makeRedis(expected, 'register_project_response')
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const handler = createRegisterProjectHandler('redis://localhost:6379')
    const result = await handler.execute(
      { name: 'my-app', workspaceType: 'local', localPath: '/home/user/app' },
      SESSION_ID,
    )

    expect(result.projectId).toBe('proj-1')
    expect(result.workspacePath).toBe('/home/user/app')
    expect(mockRedis.xadd).toHaveBeenCalledWith(
      'manager:to-orchestrator:projects',
      '*',
      'data',
      expect.stringContaining('"type":"register_project_request"'),
    )
  })

  it('project_error 응답 시 Error throw', async () => {
    const mockRedis = makeRedis({ error: 'register_project failed: DB error' }, 'project_error')
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const handler = createRegisterProjectHandler('redis://localhost:6379')
    await expect(
      handler.execute({ name: 'app', workspaceType: 'local', localPath: '/x' }, SESSION_ID),
    ).rejects.toThrow('register_project failed')
  })
})
