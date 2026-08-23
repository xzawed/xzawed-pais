import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * **Redis 게이트웨이의 localPath 판정.**
 *
 * 이 경로가 셋 중 가장 위험한데 테스트가 **0건**이었다 — Manager 의 `register_project`
 * 도구가 도달하는 지점이라 **LLM 이 `localPath` 값을 정한다.** 게다가 게이트웨이
 * 스키마는 `payload: z.unknown()` 이고 소비 지점은 타입 단언뿐이라 무엇이든 들어온다.
 *
 * `onRegister` 는 `buildServer` 안의 클로저라 직접 import 할 수 없다.
 * `ProjectGatewayConsumer` 생성자 인자를 가로채 **실제 클로저**를 손에 넣는다 —
 * 프로덕션 코드를 테스트를 위해 바꾸지 않는다.
 */

const SESSION_ID = '11111111-1111-4111-8111-111111111111'

const captured: { onRegister?: (sessionId: string, payload: unknown) => Promise<unknown> } = {}

const mockCreate = vi.fn()
const mockUpdateWorkspace = vi.fn()
const mockUpdateProject = vi.fn()

vi.mock('../projects/project-gateway.js', () => ({
  ProjectGatewayConsumer: vi.fn().mockImplementation(function (
    _url: string,
    onRegister: (sessionId: string, payload: unknown) => Promise<unknown>,
  ) {
    captured.onRegister = onRegister
    return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }
  }),
}))

vi.mock('../projects/project.repo.js', () => ({
  ProjectRepo: vi.fn().mockImplementation(function () {
    return { create: mockCreate, updateWorkspace: mockUpdateWorkspace, findById: vi.fn(), findByIdAndUser: vi.fn() }
  }),
}))

vi.mock('../db/pool.js', () => ({
  createPool: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() })),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  closePool: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../sessions/pg-session.store.js', () => ({
  PgSessionStore: vi.fn().mockImplementation(function () {
    return {
      // 핸들러가 세션을 먼저 찾는다. HTTP 로 진짜 세션을 만들려면 Redis 가 필요해
      // 판정 경로에 닿지 못하므로 스토어만 세운다.
      findById: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: 'user-1' }),
      updateProject: mockUpdateProject,
      create: vi.fn(), list: vi.fn(), delete: vi.fn(), append: vi.fn(), messages: vi.fn(),
    }
  }),
}))

vi.mock('../projects/workspace.service.js', () => ({
  WorkspaceService: vi.fn().mockImplementation(function () {
    return {
      clonePath: vi.fn().mockReturnValue('/workspace/proj-1'),
      cloneRepo: vi.fn().mockResolvedValue(undefined),
      pullRepo: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

import { buildServer } from '../server.js'
import type { Config } from '../config.js'

const CONFIG: Config = {
  port: 0,
  redisUrl: 'redis://127.0.0.1:6380',
  managerUrl: 'http://localhost:3001',
  claudeMode: 'cli',
  mode: 'local',
  auth: 'none',
  allowedOrigins: [],
  trustProxy: false,
  claudeModel: 'test',
  serveWeb: false,
  // databaseUrl 이 있어야 `if (dbPool)` 안의 게이트웨이가 배선된다.
  // userJwtSecret 은 **일부러 뺀다** — 있으면 userAuthHook 이 붙어 세션 생성이
  // 401 이 되고, 이 테스트가 검사하려는 경로 판정에 도달하지 못한다.
  databaseUrl: 'postgres://test:test@localhost:5432/test',
}

let app: FastifyInstance

async function register(payload: unknown): Promise<unknown> {
  if (!captured.onRegister) throw new Error('onRegister를 가로채지 못했다')
  return captured.onRegister(SESSION_ID, payload)
}

beforeEach(async () => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({ id: 'proj-1', name: 'p' })
  mockUpdateWorkspace.mockResolvedValue({ id: 'proj-1' })
  app = await buildServer(CONFIG, { async *send() { yield { type: 'done' as const, content: '' } } })
  if (!captured.onRegister) throw new Error('게이트웨이가 배선되지 않았다 — dbPool 조건 확인')
})

afterEach(async () => { await app?.close() })

describe('게이트웨이 onRegister — localPath 거부', () => {
  it.each([
    ['..', 'not-absolute'],
    ['relative/path', 'not-absolute'],
    // 빈 문자열은 기존 `localPath required` 가드가 먼저 잡는다 — 세 진입점 모두 같다.
    ['', 'localPath required'],
    ['   ', 'empty'],
    ['/../../../etc/passwd', 'dotdot-segment'],
    ['C:\\Users\\..\\Windows', 'dotdot-segment'],
    ['\\\\server\\share\\proj', 'namespace-or-unc'],
    ['//?/C:/Windows', 'namespace-or-unc'],
    ['/', 'filesystem-root'],
  ])('거부한다: %s (%s)', async (localPath, reason) => {
    // **현행은 이 값들을 전부 받아들였다** — 게이트웨이에는 `..` 검사도, 절대경로
    // 검사도 없었다. 이제 HTTP 진입점 둘과 같은 판정을 받는다.
    await expect(register({ name: 'p', workspaceType: 'local', localPath }))
      .rejects.toThrow(reason)
  })

  it('문자열이 아닌 localPath 도 거부한다 — payload 가 z.unknown() 이다', async () => {
    await expect(register({ name: 'p', workspaceType: 'local', localPath: 42 }))
      .rejects.toThrow('not-a-string')
  })

  it('거부 시 프로젝트 행을 만들지 않는다 — 고아 행 금지', async () => {
    // 이전 판은 `projectRepo.create()` 를 검증 **앞**에서 불렀다. 검증이 실패하면
    // 워크스페이스 없는 프로젝트가 남고 세션과도 연결되지 않았다.
    await expect(register({ name: 'p', workspaceType: 'local', localPath: '..' })).rejects.toThrow()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdateWorkspace).not.toHaveBeenCalled()
  })
})

void mockUpdateProject
