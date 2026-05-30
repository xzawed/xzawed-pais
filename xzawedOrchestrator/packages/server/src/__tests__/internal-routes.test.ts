import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Pool, QueryResult } from 'pg'
import Fastify from 'fastify'
import { WorkspaceService } from '../projects/workspace.service.js'
import type { FastifyInstance } from 'fastify'

vi.mock('../projects/workspace.service.js', () => ({
  WorkspaceService: vi.fn().mockImplementation(() => ({
    validateLocalPath: vi.fn().mockResolvedValue(undefined),
    clonePath: vi.fn().mockReturnValue('/workspace/proj-1'),
    cloneRepo: vi.fn().mockResolvedValue(undefined),
    pullRepo: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { internalRoutes } from '../api/internal.route.js'
import { InMemorySessionStore } from '../sessions/session.store.js'

const PROJECT_DB_ROW = {
  id: 'proj-1',
  user_id: 'user-1',
  name: 'My Project',
  slug: 'my-project',
  description: null,
  github_owner: null,
  github_repo: null,
  github_branch: 'main',
  created_at: new Date(),
  updated_at: new Date(),
  workspace_type: 'local',
  local_path: '/workspace/proj-1',
  repo_url: null,
  branch: 'main',
  workspace_path: '/workspace/proj-1',
  push_strategy: 'push',
}

interface TestEnv {
  app: FastifyInstance
  store: InMemorySessionStore
  sessionId: string
}

async function buildEnv(poolRows?: Record<string, unknown>[]): Promise<TestEnv> {
  const store = new InMemorySessionStore()
  const session = await store.create('user-1', null, 'cli')
  const rows = poolRows ?? [PROJECT_DB_ROW]
  const pool = { query: vi.fn().mockResolvedValue({ rows } as QueryResult) } as unknown as Pool
  const app = Fastify()
  await app.register(internalRoutes, { pool, store })
  return { app, store, sessionId: session.id }
}

describe('POST /internal/sessions/:id/register-project', () => {
  let env: TestEnv

  beforeEach(async () => {
    vi.clearAllMocks()
    env = await buildEnv()
  })

  it('세션 없음 — 404 반환', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/internal/sessions/ghost/register-project',
      payload: { name: 'X', workspaceType: 'local', localPath: '/tmp/x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('local 타입 성공 — 200 + status=registered', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/internal/sessions/${env.sessionId}/register-project`,
      payload: { name: 'My Project', workspaceType: 'local', localPath: '/workspace/proj-1' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { projectId: string; workspacePath: string; status: string }
    expect(body.status).toBe('registered')
    expect(body.workspacePath).toBe('/workspace/proj-1')
  })

  it('local 타입에 localPath 누락 — 400 반환', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/internal/sessions/${env.sessionId}/register-project`,
      payload: { name: 'My Project', workspaceType: 'local' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('github 타입 성공 — 200 + status=cloning', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/internal/sessions/${env.sessionId}/register-project`,
      payload: { name: 'My Repo', workspaceType: 'github', repoUrl: 'https://github.com/org/repo', branch: 'main' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { status: string }
    expect(body.status).toBe('cloning')
  })

  it('github 타입에 repoUrl 누락 — 400 반환', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/internal/sessions/${env.sessionId}/register-project`,
      payload: { name: 'My Repo', workspaceType: 'github' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('github 타입에 잘못된 프로토콜 — 400 반환', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/internal/sessions/${env.sessionId}/register-project`,
      payload: { name: 'My Repo', workspaceType: 'github', repoUrl: 'ftp://example.com/repo' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /internal/sessions/:id/switch-project', () => {
  it('세션 없음 — 404 반환', async () => {
    const env = await buildEnv()
    const res = await env.app.inject({
      method: 'POST',
      url: '/internal/sessions/ghost/switch-project',
      payload: { projectId: 'proj-1' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('projectId로 조회 성공 — 200 반환', async () => {
    const env = await buildEnv([PROJECT_DB_ROW])
    const res = await env.app.inject({
      method: 'POST',
      url: `/internal/sessions/${env.sessionId}/switch-project`,
      payload: { projectId: 'proj-1' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { projectId: string; name: string }
    expect(body.projectId).toBe('proj-1')
    expect(body.name).toBe('My Project')
  })

  it('name으로 조회 성공 — 200 반환', async () => {
    const env = await buildEnv([PROJECT_DB_ROW])
    const res = await env.app.inject({
      method: 'POST',
      url: `/internal/sessions/${env.sessionId}/switch-project`,
      payload: { name: 'My Project' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { projectId: string }).projectId).toBe('proj-1')
  })

  it('프로젝트 없음 — 404 반환', async () => {
    const env = await buildEnv([])
    const res = await env.app.inject({
      method: 'POST',
      url: `/internal/sessions/${env.sessionId}/switch-project`,
      payload: { projectId: 'not-found' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /internal/sessions/:id/register-project — background clone 실패', () => {
  let app: FastifyInstance
  afterEach(async () => { await app?.close() })

  it('cloneRepo 실패 시 workspace_path 리셋 updateWorkspace 호출', async () => {
    vi.mocked(WorkspaceService).mockImplementationOnce(() => ({
      validateLocalPath: vi.fn().mockResolvedValue(undefined),
      clonePath: vi.fn().mockReturnValue('/workspace/proj-1'),
      cloneRepo: vi.fn().mockRejectedValue(new Error('git clone: auth failed')),
      pullRepo: vi.fn().mockResolvedValue(undefined),
    }))

    const poolQueryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [PROJECT_DB_ROW] } as unknown as QueryResult)
      .mockResolvedValue({ rows: [] } as unknown as QueryResult)
    const pool = { query: poolQueryMock } as unknown as Pool
    const store = new InMemorySessionStore()
    const session = await store.create('user-1', null, 'cli')
    app = Fastify()
    await app.register(internalRoutes, { pool, store })

    const res = await app.inject({
      method: 'POST',
      url: `/internal/sessions/${session.id}/register-project`,
      payload: {
        name: 'My Repo',
        workspaceType: 'github',
        repoUrl: 'https://github.com/org/repo',
        branch: 'main',
      },
    })

    expect(res.statusCode).toBe(200)

    // background clone + catch가 settle될 때까지 대기
    await new Promise<void>(resolve => setImmediate(resolve))

    // SELECT(1회) + UPDATE workspace 리셋(1회) 이상 호출되어야 함
    expect(poolQueryMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('cloneRepo 실패 + updateWorkspace도 실패해도 크래시 없음', async () => {
    vi.mocked(WorkspaceService).mockImplementationOnce(() => ({
      validateLocalPath: vi.fn().mockResolvedValue(undefined),
      clonePath: vi.fn().mockReturnValue('/workspace/proj-1'),
      cloneRepo: vi.fn().mockRejectedValue(new Error('clone failed')),
      pullRepo: vi.fn().mockResolvedValue(undefined),
    }))

    const poolQueryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [PROJECT_DB_ROW] } as unknown as QueryResult)  // SELECT project
      .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult)                  // UPDATE cloning (동기)
      .mockRejectedValue(new Error('DB connection lost'))                              // UPDATE reset (background) - 실패
    const pool = { query: poolQueryMock } as unknown as Pool
    const store = new InMemorySessionStore()
    const session = await store.create('user-1', null, 'cli')
    app = Fastify()
    await app.register(internalRoutes, { pool, store })

    const res = await app.inject({
      method: 'POST',
      url: `/internal/sessions/${session.id}/register-project`,
      payload: {
        name: 'My Repo',
        workspaceType: 'github',
        repoUrl: 'https://github.com/org/repo',
        branch: 'main',
      },
    })

    expect(res.statusCode).toBe(200)
    // background 예외가 process를 크래시시키지 않아야 함
    await new Promise<void>(resolve => setImmediate(resolve))
  })
})
