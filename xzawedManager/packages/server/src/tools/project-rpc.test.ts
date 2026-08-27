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
    await expect(handler.execute({ name: 'bad', workspaceType: 'local', localPath: '/tmp/bad' }, SESSION_ID))
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

/**
 * **입력 가드는 Redis 로 나가기 전에 막는다.**
 *
 * 두 핸들러의 행복 경로와 `project_error` 응답은 위에서 덮이지만 **자기 입력 검사는 어디서도
 * 단언되지 않았다** — 감사(3회 반복 검증) 중 두 `throw` 를 통째로 지워도 스위트가 전부 초록인
 * 것으로 확인했다. `register_project` 는 LLM 이 워크스페이스를 지정하는 경로라, 이 가드가
 * 사라지면 `localPath` 없는 요청이 Redis 로 나가 Orchestrator 쪽에서야 실패한다.
 *
 * 응답 스키마 거부도 함께 고정한다 — 상대가 모양이 다른 payload 를 주면 **조용히 통과시키지
 * 않고** 던져야 한다(무음 통과 금지).
 */
describe('project RPC 입력·응답 가드', () => {
  const REDIS = 'redis://localhost:6379'

  it('register_project: workspaceType=local 인데 localPath 가 없으면 던진다', async () => {
    // **Redis 를 목으로 채운다.** 비워 두면 가드가 사라졌을 때 unmocked 클라이언트로 진행해
    // 워커가 비정상 종료하고, 실패 신호가 "assertion failed" 가 아니라 "worker crash" 로 나온다.
    // 채워 두면 가드 제거가 **깔끔한 단언 실패**로 드러난다(실측으로 확인).
    vi.mocked(getRedisClient).mockReturnValue(
      makeRedis({ projectId: 'p1', workspacePath: '/w', status: 'registered' }, 'register_project_response') as never,
    )
    const handler = createRegisterProjectHandler(REDIS)
    await expect(handler.execute({ name: 'p', workspaceType: 'local' }, SESSION_ID))
      .rejects.toThrow('localPath')
  })

  /** github 은 localPath 가 없어도 정상이다 — 과잉 차단이면 등록 자체가 막힌다. */
  it('register_project: workspaceType=github 는 localPath 없이도 요청을 낸다', async () => {
    vi.mocked(getRedisClient).mockReturnValue(
      makeRedis({ projectId: 'p1', workspacePath: null, status: 'cloning' }, 'register_project_response') as never,
    )
    const handler = createRegisterProjectHandler(REDIS)
    await expect(handler.execute({ name: 'p', workspaceType: 'github', repoUrl: 'https://x/y' }, SESSION_ID))
      .resolves.toMatchObject({ status: 'cloning' })
  })

  it('switch_project: projectId·name 이 둘 다 없으면 던진다', async () => {
    vi.mocked(getRedisClient).mockReturnValue(
      makeRedis({ projectId: 'p1', name: 'n', workspacePath: '/w' }, 'switch_project_response') as never,
    )
    const handler = createSwitchProjectHandler(REDIS)
    await expect(handler.execute({}, SESSION_ID)).rejects.toThrow('projectId')
  })

  it('register_project: 모양이 다른 응답 payload 는 거부한다(무음 통과 금지)', async () => {
    vi.mocked(getRedisClient).mockReturnValue(
      makeRedis({ wrong: 'shape' }, 'register_project_response') as never,
    )
    const handler = createRegisterProjectHandler(REDIS)
    await expect(handler.execute({ name: 'p', workspaceType: 'github' }, SESSION_ID))
      .rejects.toThrow('invalid response payload')
  })

  it('switch_project: 모양이 다른 응답 payload 는 거부한다(무음 통과 금지)', async () => {
    vi.mocked(getRedisClient).mockReturnValue(
      makeRedis({ wrong: 'shape' }, 'switch_project_response') as never,
    )
    const handler = createSwitchProjectHandler(REDIS)
    await expect(handler.execute({ projectId: 'p1' }, SESSION_ID))
      .rejects.toThrow('invalid response payload')
  })
})
