import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('../../streams/redis.client.js', () => ({ getRedisClient: vi.fn() }))

import { getRedisClient } from '../../streams/redis.client.js'
import { createSwitchProjectHandler } from '../switch-project.js'

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

describe('switch_project tool', () => {
  it('프로젝트 전환 성공', async () => {
    const expected = { projectId: 'proj-2', name: 'other-app', workspacePath: '/home/user/other' }
    const mockRedis = makeRedis(expected, 'switch_project_response')
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const handler = createSwitchProjectHandler('redis://localhost:6379')
    const result = await handler.execute({ projectId: 'proj-2' }, SESSION_ID)

    expect(result.projectId).toBe('proj-2')
    expect(mockRedis.xadd).toHaveBeenCalledWith(
      'manager:to-orchestrator:projects',
      '*',
      'data',
      expect.stringContaining('"type":"switch_project_request"'),
    )
  })

  it('project_error 응답 시 Error throw', async () => {
    const mockRedis = makeRedis({ error: 'switch_project failed: Not Found' }, 'project_error')
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

    const handler = createSwitchProjectHandler('redis://localhost:6379')
    await expect(
      handler.execute({ name: 'unknown-app' }, SESSION_ID),
    ).rejects.toThrow('switch_project failed')
  })

  it('projectId와 name 모두 없으면 Error throw', async () => {
    const handler = createSwitchProjectHandler('redis://localhost:6379')
    await expect(
      handler.execute({}, SESSION_ID),
    ).rejects.toThrow('projectId 또는 name 중 하나는 필수입니다')
  })
})
