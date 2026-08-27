import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * **Redis 게이트웨이의 `onSwitch` 판정.**
 *
 * `gateway-localpath.test.ts` 가 같은 방식으로 `onRegister` 를 가로채 검사하는데
 * **`onSwitch` 는 아무도 잡지 않아 커버리지가 0이었다**(실측: `server.ts` 310~326 전량 미커버).
 * Manager 에서 고친 것과 같은 형태다 — 배선 안에 든 분기 로직은 아무도 안 본다.
 *
 * 이 경로는 Manager 의 `switch_project` 도구가 도달하는 지점이고 게이트웨이 스키마가
 * `payload: z.unknown()` 이라 **무엇이든 들어온다.** 판정은 셋이다:
 *   1. 세션이 없으면 거부
 *   2. `projectId` 가 있으면 **소유자 스코프**로 조회(`findByIdAndUser`)
 *   3. 없고 `name` 이 있으면 사용자 프로젝트 중 **name 또는 slug** 일치
 * 어느 쪽으로도 못 찾으면 거부하고, 찾으면 세션의 현재 프로젝트를 바꾼다.
 *
 * `onSwitch` 는 `buildServer` 안의 클로저라 직접 import 할 수 없다. 생성자 인자를
 * 가로채 **실제 클로저**를 손에 넣는다 — 프로덕션 코드를 테스트를 위해 바꾸지 않는다.
 */

const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = 'user-1'

const captured: { onSwitch?: (sessionId: string, payload: unknown) => Promise<unknown> } = {}

const mockFindByIdAndUser = vi.fn()
const mockFindByUser = vi.fn()
const mockUpdateProject = vi.fn()
const mockFindSession = vi.fn()

vi.mock('../projects/project-gateway.js', () => ({
  ProjectGatewayConsumer: vi.fn().mockImplementation(function (
    _url: string,
    _onRegister: unknown,
    onSwitch: (sessionId: string, payload: unknown) => Promise<unknown>,
  ) {
    captured.onSwitch = onSwitch
    return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }
  }),
}))

vi.mock('../projects/project.repo.js', () => ({
  ProjectRepo: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn(), updateWorkspace: vi.fn(), findById: vi.fn(),
      findByIdAndUser: mockFindByIdAndUser,
      findByUser: mockFindByUser,
    }
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
      findById: mockFindSession,
      updateProject: mockUpdateProject,
      create: vi.fn(), list: vi.fn(), delete: vi.fn(), append: vi.fn(), messages: vi.fn(),
    }
  }),
}))

vi.mock('../projects/workspace.service.js', () => ({
  WorkspaceService: vi.fn().mockImplementation(function () {
    return { clonePath: vi.fn(), cloneRepo: vi.fn(), pullRepo: vi.fn() }
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
  databaseUrl: 'postgres://test:test@localhost:5432/test',
}

let app: FastifyInstance

async function doSwitch(payload: unknown): Promise<unknown> {
  if (!captured.onSwitch) throw new Error('onSwitch를 가로채지 못했다')
  return captured.onSwitch(SESSION_ID, payload)
}

const PROJECT = { id: 'proj-1', name: 'alpha', slug: 'alpha-slug', workspace_path: '/ws/alpha' }

beforeEach(async () => {
  vi.clearAllMocks()
  mockFindSession.mockResolvedValue({ id: SESSION_ID, userId: USER_ID })
  mockUpdateProject.mockResolvedValue(undefined)
  app = await buildServer(CONFIG, { async *send() { yield { type: 'done' as const, content: '' } } })
  if (!captured.onSwitch) throw new Error('게이트웨이가 배선되지 않았다 — dbPool 조건 확인')
})

afterEach(async () => { await app?.close() })

describe('게이트웨이 onSwitch — 세션 전제', () => {
  it('세션이 없으면 거부하고 프로젝트를 바꾸지 않는다', async () => {
    mockFindSession.mockResolvedValue(undefined)
    await expect(doSwitch({ projectId: 'proj-1' })).rejects.toThrow('Session not found')
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })
})

describe('게이트웨이 onSwitch — projectId 경로', () => {
  /** **소유자 스코프 조회여야 한다.** 전역 조회면 남의 프로젝트로 갈아탈 수 있다. */
  it('projectId 는 세션 사용자 스코프로 조회한다', async () => {
    mockFindByIdAndUser.mockResolvedValue(PROJECT)
    const out = await doSwitch({ projectId: 'proj-1' })
    expect(mockFindByIdAndUser).toHaveBeenCalledWith('proj-1', USER_ID)
    expect(mockFindByUser).not.toHaveBeenCalled()
    expect(mockUpdateProject).toHaveBeenCalledWith(SESSION_ID, 'proj-1')
    expect(out).toEqual({ projectId: 'proj-1', name: 'alpha', workspacePath: '/ws/alpha' })
  })

  it('남의 프로젝트 id 면(소유자 조회가 비면) 거부한다', async () => {
    mockFindByIdAndUser.mockResolvedValue(undefined)
    await expect(doSwitch({ projectId: 'someone-elses' })).rejects.toThrow('Project not found')
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })
})

describe('게이트웨이 onSwitch — name 경로', () => {
  it('name 이 일치하면 찾는다', async () => {
    mockFindByUser.mockResolvedValue([{ id: 'other', name: 'beta', slug: 'beta' }, PROJECT])
    const out = await doSwitch({ name: 'alpha' })
    expect(mockFindByIdAndUser).not.toHaveBeenCalled()
    expect(mockFindByUser).toHaveBeenCalledWith(USER_ID)
    expect(out).toMatchObject({ projectId: 'proj-1', name: 'alpha' })
  })

  /** name 과 slug 를 둘 다 본다 — 한쪽만 보면 slug 로 부르는 호출자가 조용히 실패한다. */
  it('slug 로도 찾는다', async () => {
    mockFindByUser.mockResolvedValue([PROJECT])
    const out = await doSwitch({ name: 'alpha-slug' })
    expect(out).toMatchObject({ projectId: 'proj-1' })
  })

  it('일치하는 것이 없으면 거부한다', async () => {
    mockFindByUser.mockResolvedValue([{ id: 'other', name: 'beta', slug: 'beta' }])
    await expect(doSwitch({ name: 'nope' })).rejects.toThrow('Project not found')
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })

  /** **projectId 가 우선한다** — 둘 다 오면 name 조회로 새지 않아야 한다. */
  it('projectId 와 name 이 함께 오면 projectId 만 쓴다', async () => {
    mockFindByIdAndUser.mockResolvedValue(PROJECT)
    await doSwitch({ projectId: 'proj-1', name: 'beta' })
    expect(mockFindByIdAndUser).toHaveBeenCalledWith('proj-1', USER_ID)
    expect(mockFindByUser).not.toHaveBeenCalled()
  })
})

describe('게이트웨이 onSwitch — 식별자가 아예 없을 때', () => {
  /**
   * 스키마가 `z.unknown()` 이라 빈 객체·null·문자열이 그대로 도달한다.
   * 어느 쪽도 조회를 돌리지 않고 거부해야 한다(무음 통과 금지).
   */
  it.each([
    ['빈 객체', {}],
    ['null', null],
    ['문자열', 'alpha'],
    ['배열', ['alpha']],
  ])('%s 이면 조회 없이 거부한다', async (_label, payload) => {
    await expect(doSwitch(payload)).rejects.toThrow('Project not found')
    expect(mockFindByIdAndUser).not.toHaveBeenCalled()
    expect(mockFindByUser).not.toHaveBeenCalled()
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })
})

describe('게이트웨이 onSwitch — workspacePath 정규화', () => {
  it('workspace_path 가 없으면 null 로 돌려준다(undefined 누출 금지)', async () => {
    mockFindByIdAndUser.mockResolvedValue({ id: 'proj-2', name: 'gamma' })
    const out = await doSwitch({ projectId: 'proj-2' })
    expect(out).toEqual({ projectId: 'proj-2', name: 'gamma', workspacePath: null })
  })
})
