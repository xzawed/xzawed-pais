import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool, QueryResult } from 'pg'
import Fastify from 'fastify'
import { projectsRoutes } from '../api/projects.route.js'
import { issueAccessToken } from '../auth/tokens.js'

const SECRET = 'test-secret-key-that-is-long-enough-32ch'

function makeToken(sub = 'user-1'): string {
  return issueAccessToken({ sub, email: 'a@b.com', displayName: null }, SECRET)
}

const GITHUB_PROJECT_ROW = {
  id: 'proj-1',
  user_id: 'user-1',
  name: 'Test',
  slug: 'test',
  description: null,
  github_owner: null,
  github_repo: null,
  github_branch: 'main',
  created_at: new Date(),
  updated_at: new Date(),
  workspace_type: 'github',
  local_path: null,
  repo_url: 'https://github.com/test/repo',
  branch: 'main',
  workspace_path: '/home/.xzawed/workspaces/proj-1',
  push_strategy: 'push',
}

const LOCAL_PROJECT_ROW = {
  ...GITHUB_PROJECT_ROW,
  workspace_type: 'local',
  local_path: '/home/user/project',
  repo_url: null,
  workspace_path: '/home/user/project',
}

vi.mock('../projects/workspace.service.js', () => ({
  WorkspaceService: vi.fn().mockImplementation(function () { return ({
    validateLocalPath: vi.fn().mockResolvedValue(undefined),
    clonePath: vi.fn().mockReturnValue('/home/.xzawed/workspaces/proj-1'),
    cloneRepo: vi.fn().mockResolvedValue(undefined),
    pullRepo: vi.fn().mockResolvedValue(undefined),
  }) }),
}))

function makePool(rows: Record<string, unknown>[] = [GITHUB_PROJECT_ROW]) {
  return { query: vi.fn().mockResolvedValue({ rows } as QueryResult) } as unknown as Pool
}

async function buildApp(pool: Pool) {
  const app = Fastify()
  await app.register(projectsRoutes, { pool, userJwtSecret: SECRET })
  return app
}

describe('workspace routes', () => {
  let pool: Pool

  beforeEach(() => {
    pool = makePool()
    vi.clearAllMocks()
  })

  describe('PATCH /projects/:id/workspace', () => {
    it('local 타입 — 성공 시 200 반환', async () => {
      pool = makePool([LOCAL_PROJECT_ROW])
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/proj-1/workspace',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { workspaceType: 'local', localPath: '/home/user/project' },
      })
      expect(res.statusCode).toBe(200)
    })

    it('github 타입 — 성공 시 200 반환', async () => {
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/proj-1/workspace',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { workspaceType: 'github', repoUrl: 'https://github.com/test/repo', branch: 'main' },
      })
      expect(res.statusCode).toBe(200)
    })

    it('프로젝트 없음 — 404 반환', async () => {
      pool = makePool([])
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/non-existent/workspace',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { workspaceType: 'local', localPath: '/some/path' },
      })
      expect(res.statusCode).toBe(404)
    })

    it('local 타입에 localPath 누락 — 400 반환', async () => {
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/proj-1/workspace',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { workspaceType: 'local' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('github 타입에 repoUrl 누락 — 400 반환', async () => {
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/proj-1/workspace',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { workspaceType: 'github' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('잘못된 repoUrl 프로토콜 — 400 반환', async () => {
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/proj-1/workspace',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { workspaceType: 'github', repoUrl: 'ftp://example.com/repo' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('localPath에 .. 포함 — 400 반환 (경로 traversal 차단)', async () => {
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/proj-1/workspace',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { workspaceType: 'local', localPath: '/../../../etc/passwd' },
      })
      expect(res.statusCode).toBe(400)
      expect((res.json() as { error: string }).error).toContain('absolute')
    })

    it('localPath가 상대경로 — 400 반환 (절대경로 필수)', async () => {
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/proj-1/workspace',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { workspaceType: 'local', localPath: 'relative/path/to/project' },
      })
      expect(res.statusCode).toBe(400)
      expect((res.json() as { error: string }).error).toContain('absolute')
    })

    it('local 타입 — 응답 body에 project 포함', async () => {
      pool = makePool([LOCAL_PROJECT_ROW])
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/proj-1/workspace',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { workspaceType: 'local', localPath: '/home/user/project' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { project: { id: string } }
      expect(body).toHaveProperty('project')
      expect(body.project.id).toBe('proj-1')
    })

    it('인증 없음 — 401 반환', async () => {
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'PATCH',
        url: '/projects/proj-1/workspace',
        payload: { workspaceType: 'local', localPath: '/some/path' },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('POST /projects/:id/sync', () => {
    it('github 타입 — 성공 시 200 반환', async () => {
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/sync',
        headers: { authorization: `Bearer ${makeToken()}` },
      })
      expect(res.statusCode).toBe(200)
      expect((res.json() as { ok: boolean }).ok).toBe(true)
    })

    it('프로젝트 없음 — 404 반환', async () => {
      pool = makePool([])
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'POST',
        url: '/projects/non-existent/sync',
        headers: { authorization: `Bearer ${makeToken()}` },
      })
      expect(res.statusCode).toBe(404)
    })

    it('local 타입 프로젝트 — 400 반환', async () => {
      pool = makePool([LOCAL_PROJECT_ROW])
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/sync',
        headers: { authorization: `Bearer ${makeToken()}` },
      })
      expect(res.statusCode).toBe(400)
    })

    it('workspace_path 없음 — 400 반환', async () => {
      pool = makePool([{ ...GITHUB_PROJECT_ROW, workspace_path: null }])
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/sync',
        headers: { authorization: `Bearer ${makeToken()}` },
      })
      expect(res.statusCode).toBe(400)
    })

    it('인증 없음 — 401 반환', async () => {
      const app = await buildApp(pool)
      const res = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/sync',
      })
      expect(res.statusCode).toBe(401)
    })
  })
})
