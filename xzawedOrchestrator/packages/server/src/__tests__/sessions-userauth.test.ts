import { describe, it, expect, vi } from 'vitest'
import type { Pool, QueryResult } from 'pg'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../streams/consumer.js', () => ({
  StreamConsumer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  })),
}))

import { sessionsRoutes, resolveSessionWorkspaceRoot } from '../api/sessions.route.js'
import { makeUserAuthHook } from '../auth/user-auth.hook.js'
import { InMemorySessionStore } from '../sessions/session.store.js'
import { issueAccessToken } from '../auth/tokens.js'
import type { ManagerClient } from '../manager/manager.client.js'
import type { StreamProducer } from '../streams/producer.js'
import type { Project } from '../projects/project.repo.js'

const SECRET = 'auth-secret-key-that-is-32chars-ok'

const PROJ_ROW = {
  id: 'proj-42',
  user_id: 'user-42',
  name: 'My Workspace',
  slug: 'my-workspace',
  description: null,
  github_owner: null,
  github_repo: null,
  github_branch: 'main',
  created_at: new Date(),
  updated_at: new Date(),
  workspace_type: 'local',
  local_path: '/ws/proj-42',
  repo_url: null,
  branch: 'main',
  workspace_path: '/ws/proj-42',
  push_strategy: 'push',
}

function makeToken(sub = 'user-42'): string {
  return issueAccessToken({ sub, email: 'u@test.com', displayName: null }, SECRET)
}

async function buildAuthedApp(poolRows: Record<string, unknown>[]): Promise<FastifyInstance> {
  const app = Fastify()
  const store = new InMemorySessionStore()
  const pool = { query: vi.fn().mockResolvedValue({ rows: poolRows } as QueryResult) } as unknown as Pool
  const userAuthHook = makeUserAuthHook(SECRET)

  await app.register(sessionsRoutes, {
    store,
    runner: { async *send() { yield { type: 'done', content: '' } } },
    wsSessions: new Map(),
    manager: { startSession: vi.fn().mockResolvedValue(undefined) } as unknown as ManagerClient,
    redisUrl: 'redis://127.0.0.1:6380',
    producer: { publish: vi.fn().mockResolvedValue(undefined) } as unknown as StreamProducer,
    sessionConsumers: new Map(),
    sessionCleanup: new Map(),
    userAuthHook,
    pool,
  })
  return app
}

describe('resolveSessionWorkspaceRoot', () => {
  it('project.workspace_path 있으면 해당 경로 반환', () => {
    const project = { workspace_path: '/custom/path' } as unknown as Project
    expect(resolveSessionWorkspaceRoot(project, '/fallback')).toBe('/custom/path')
  })

  it('project null이면 fallback 반환', () => {
    expect(resolveSessionWorkspaceRoot(null, '/fallback')).toBe('/fallback')
  })

  it('workspace_path null이면 fallback 반환', () => {
    const project = { workspace_path: null } as unknown as Project
    expect(resolveSessionWorkspaceRoot(project, '/fallback')).toBe('/fallback')
  })
})

describe('POST /sessions — userAuthHook 경로', () => {
  it('토큰 없음 — 401 반환', async () => {
    const app = await buildAuthedApp([PROJ_ROW])
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { projectId: 'proj-42' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('projectId 없음 — 400 반환', async () => {
    const app = await buildAuthedApp([PROJ_ROW])
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('프로젝트 없음 — 404 반환', async () => {
    const app = await buildAuthedApp([])
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { projectId: 'no-such-project' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('인증 성공 + 프로젝트 존재 — 201 + sessionId 반환', async () => {
    const app = await buildAuthedApp([PROJ_ROW])
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { projectId: 'proj-42' },
    })
    expect(res.statusCode).toBe(201)
    expect(typeof (res.json() as { sessionId: string }).sessionId).toBe('string')
  })
})
