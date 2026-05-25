import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool, QueryResult } from 'pg'
import Fastify from 'fastify'
import { projectsRoutes } from '../api/projects.route.js'
import { issueAccessToken } from '../auth/tokens.js'
import { randomBytes } from 'node:crypto'

const SECRET = 'test-secret-key-that-is-long-enough-32ch'
const ENC_KEY = randomBytes(32).toString('hex')

function makeToken(sub = 'user-1'): string {
  return issueAccessToken({ sub, email: 'a@b.com', displayName: null }, SECRET)
}

const PROJECT_ROW = {
  id: 'proj-1',
  user_id: 'user-1',
  name: 'Test Project',
  slug: 'test-project',
  description: null,
  github_owner: null,
  github_repo: null,
  github_branch: 'main',
  created_at: new Date(),
  updated_at: new Date(),
}

function makePool(rows: Record<string, unknown>[] = [PROJECT_ROW]) {
  return { query: vi.fn().mockResolvedValue({ rows } as QueryResult) } as unknown as Pool
}

async function buildApp(pool: Pool, opts: { withEncKey?: boolean } = { withEncKey: true }) {
  const app = Fastify()
  await app.register(projectsRoutes, {
    pool,
    userJwtSecret: SECRET,
    ...(opts.withEncKey ? { githubTokenEncryptionKey: ENC_KEY } : {}),
  })
  return app
}

describe('GET /projects', () => {
  it('인증된 사용자 — 프로젝트 목록 반환', async () => {
    const pool = makePool([PROJECT_ROW])
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${makeToken()}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { projects: { id: string }[] }
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0]?.id).toBe('proj-1')
  })

  it('인증 없음 — 401 반환', async () => {
    const app = await buildApp(makePool())
    const res = await app.inject({ method: 'GET', url: '/projects' })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /projects', () => {
  let pool: Pool

  beforeEach(() => { pool = makePool() })

  it('유효한 요청 — 201 + 프로젝트 반환', async () => {
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { name: 'New Project' },
    })
    expect(res.statusCode).toBe(201)
    expect((res.json() as { project: { id: string } }).project.id).toBe('proj-1')
  })

  it('name 빈 문자열 — 400 반환', async () => {
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { name: '   ' },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toContain('name')
  })

  it('name 미제공 — 400 반환', async () => {
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('인증 없음 — 401 반환', async () => {
    const app = await buildApp(pool)
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'X' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /projects/:id', () => {
  it('프로젝트 있음 — 200 + 프로젝트 반환', async () => {
    const pool = makePool([PROJECT_ROW])
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'GET',
      url: '/projects/proj-1',
      headers: { authorization: `Bearer ${makeToken()}` },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { project: { id: string } }).project.id).toBe('proj-1')
  })

  it('프로젝트 없음 — 404 반환', async () => {
    const pool = makePool([])
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'GET',
      url: '/projects/non-existent',
      headers: { authorization: `Bearer ${makeToken()}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('인증 없음 — 401 반환', async () => {
    const app = await buildApp(makePool())
    const res = await app.inject({ method: 'GET', url: '/projects/proj-1' })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /projects/:id', () => {
  it('프로젝트 있음 — 200 + 업데이트된 프로젝트 반환', async () => {
    const pool = makePool([PROJECT_ROW])
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/proj-1',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { name: 'Updated Name' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('프로젝트 없음 — 404 반환', async () => {
    const pool = makePool([])
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/non-existent',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('인증 없음 — 401 반환', async () => {
    const app = await buildApp(makePool())
    const res = await app.inject({ method: 'PATCH', url: '/projects/proj-1', payload: { name: 'x' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /projects/:id', () => {
  it('프로젝트 있음 — 204 반환', async () => {
    const pool = makePool([PROJECT_ROW])
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/proj-1',
      headers: { authorization: `Bearer ${makeToken()}` },
    })
    expect(res.statusCode).toBe(204)
  })

  it('프로젝트 없음 — 404 반환', async () => {
    const pool = makePool([])
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/non-existent',
      headers: { authorization: `Bearer ${makeToken()}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('인증 없음 — 401 반환', async () => {
    const app = await buildApp(makePool())
    const res = await app.inject({ method: 'DELETE', url: '/projects/proj-1' })
    expect(res.statusCode).toBe(401)
  })
})

describe('PUT /projects/:id/github-token — 암호화 키 없음', () => {
  it('githubTokenEncryptionKey 미설정 — 503 반환', async () => {
    const pool = makePool([PROJECT_ROW])
    const app = await buildApp(pool, { withEncKey: false })
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/proj-1/github-token',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { token: 'ghp_test123' },
    })
    expect(res.statusCode).toBe(503)
    expect((res.json() as { error: string }).error).toContain('not configured')
  })
})
