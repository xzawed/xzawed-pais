import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool, QueryResult } from 'pg'
import Fastify from 'fastify'
import { projectsRoutes } from '../api/projects.route.js'
import { issueAccessToken } from '../auth/tokens.js'
import { randomBytes } from 'node:crypto'

const SECRET = 'test-secret-key-that-is-long-enough-32ch'
const ENC_KEY = randomBytes(32).toString('base64')

function makeToken(sub = 'user-1'): string {
  return issueAccessToken({ sub, email: 'a@b.com', displayName: null }, SECRET)
}

const PROJECT_ROW = {
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
}

function makePool(rows: Record<string, unknown>[] = [PROJECT_ROW]) {
  return { query: vi.fn().mockResolvedValue({ rows } as QueryResult) } as unknown as Pool
}

async function buildApp(pool: Pool) {
  const app = Fastify()
  await app.register(projectsRoutes, { pool, userJwtSecret: SECRET, githubTokenEncryptionKey: ENC_KEY })
  return app
}

describe('GitHub token API routes', () => {
  let pool: Pool

  beforeEach(() => {
    pool = makePool()
  })

  it('PUT /projects/:id/github-token — 토큰 저장 성공', async () => {
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/proj-1/github-token',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { token: 'ghp_testtoken1234' },
    })
    expect(res.statusCode).toBe(204)
  })

  it('PUT /projects/:id/github-token — 토큰 없으면 400', async () => {
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/proj-1/github-token',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE /projects/:id/github-token — 성공', async () => {
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/proj-1/github-token',
      headers: { authorization: `Bearer ${makeToken()}` },
    })
    expect(res.statusCode).toBe(204)
  })

  it('GET /projects/:id/github-token/status — 토큰 있으면 exists:true', async () => {
    const tokenPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [PROJECT_ROW] } as QueryResult)
        .mockResolvedValueOnce({ rows: [{ token_cipher: Buffer.alloc(16), token_iv: Buffer.alloc(12), token_tag: Buffer.alloc(16) }] } as QueryResult),
    } as unknown as Pool
    const app = await buildApp(tokenPool)
    const res = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/github-token/status',
      headers: { authorization: `Bearer ${makeToken()}` },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { exists: boolean }).exists).toBe(true)
  })

  it('GET /projects/:id/github-token/status — 토큰 없으면 exists:false', async () => {
    const emptyTokenPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [PROJECT_ROW] } as QueryResult)
        .mockResolvedValueOnce({ rows: [] as Record<string, unknown>[] } as unknown as QueryResult),
    } as unknown as Pool
    const app = await buildApp(emptyTokenPool)
    const res = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/github-token/status',
      headers: { authorization: `Bearer ${makeToken()}` },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { exists: boolean }).exists).toBe(false)
  })

  it('타 사용자는 토큰 엔드포인트에 접근 불가 — 404', async () => {
    const otherPool = {
      query: vi.fn().mockResolvedValue({ rows: [] as Record<string, unknown>[] } as unknown as QueryResult),
    } as unknown as Pool
    const app = await buildApp(otherPool)
    const res = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/github-token/status',
      headers: { authorization: `Bearer ${makeToken('other-user')}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('인증 없이 접근 시 401', async () => {
    const app = await buildApp(pool)
    const res = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/github-token/status',
    })
    expect(res.statusCode).toBe(401)
  })
})
