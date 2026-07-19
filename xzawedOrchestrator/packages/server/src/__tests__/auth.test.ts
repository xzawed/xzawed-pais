import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { issueAccessToken, verifyAccessToken, issueRefreshToken } from '../auth/tokens.js'
import { buildServer } from '../server.js'

vi.mock('../projects/project-gateway.js', () => ({
  ProjectGatewayConsumer: vi.fn().mockImplementation(function () { return ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }) }),
}))

const SECRET = 'test-secret-key-that-is-long-enough-32ch'

describe('password', () => {
  it('해시 생성 후 검증 성공', async () => {
    const hash = await hashPassword('mypassword123')
    expect(hash).toMatch(/^\$argon2/)
    await expect(verifyPassword(hash, 'mypassword123')).resolves.toBe(true)
  })

  it('잘못된 비밀번호는 false 반환', async () => {
    const hash = await hashPassword('correct')
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false)
  })
})

describe('tokens', () => {
  it('access token 발급 후 검증', () => {
    const payload = { sub: 'user-123', email: 'a@b.com', displayName: 'Test' }
    const token = issueAccessToken(payload, SECRET)
    const decoded = verifyAccessToken(token, SECRET)
    expect(decoded.sub).toBe('user-123')
    expect(decoded.email).toBe('a@b.com')
  })

  it('잘못된 secret으로 검증 시 에러', () => {
    const token = issueAccessToken({ sub: 'u', email: 'a@b.com', displayName: null }, SECRET)
    expect(() => verifyAccessToken(token, 'wrong-secret')).toThrow()
  })

  it('refresh token은 고유하고 sha256 해시를 포함한다', () => {
    const r1 = issueRefreshToken()
    const r2 = issueRefreshToken()
    expect(r1.token).not.toBe(r2.token)
    expect(r1.hash).not.toBe(r2.hash)
    expect(r1.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(r1.token.length).toBeGreaterThan(30)
  })
})

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? ''
const hasDb = DATABASE_URL !== ''

describe.skipIf(!hasDb)('auth routes integration', () => {

  const BASE_CONFIG = {
    port: 0,
    redisUrl: 'redis://127.0.0.1:6380',
    managerUrl: 'http://localhost:3001',
    claudeMode: 'cli' as const,
    mode: 'local' as const,
    auth: 'none' as const,
    claudeModel: 'test',
    serveWeb: false,
    databaseUrl: DATABASE_URL,
    userJwtSecret: 'integration-test-secret-key-32chars!!',
  }

  let app: import('fastify').FastifyInstance
  let dbPool: Pool
  const email = `integration-auth-${randomUUID()}@test.example.com`
  const password = 'Passw0rd!ok'

  beforeAll(async () => {
    app = await buildServer(BASE_CONFIG, {
      async *send() { yield { type: 'done' as const, content: '' } },
    })
    dbPool = new Pool({ connectionString: DATABASE_URL })
  })

  afterAll(async () => {
    // G11: org_id FK 순서 — user 먼저 삭제 후 연결 tenant 정리(고아 방지).
    const orphan = await dbPool.query<{ org_id: string | null }>('SELECT org_id FROM users WHERE email = $1', [email]).catch(() => ({ rows: [] as { org_id: string | null }[] }))
    await dbPool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => {})
    for (const r of orphan.rows) if (r.org_id) await dbPool.query('DELETE FROM tenants WHERE id = $1', [r.org_id]).catch(() => {})
    await dbPool.end().catch(() => {})
    await app?.close()
  })

  it('G11 Slice 1: register가 개인 org 자동 생성·JWT에 orgId claim 실림', async () => {
    const em = `g11-${randomUUID()}@test.example.com`
    const regRes = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: em, password } })
    expect(regRes.statusCode).toBe(201)
    const body = regRes.json() as { user: { id: string }; accessToken: string }

    // JWT access token에 orgId claim이 실린다(enforcement 0이지만 신원은 흐른다).
    const decoded = verifyAccessToken(body.accessToken, 'integration-test-secret-key-32chars!!')
    expect(decoded.orgId).toBeTruthy()

    // DB: user.org_id 설정 + 대응 tenants 행 존재(원자 생성).
    const { rows } = await dbPool.query<{ org_id: string }>('SELECT org_id FROM users WHERE id = $1', [body.user.id])
    expect(rows[0]?.org_id).toBe(decoded.orgId)
    const { rows: orgRows } = await dbPool.query('SELECT id FROM tenants WHERE id = $1', [decoded.orgId])
    expect(orgRows).toHaveLength(1)

    // cleanup(FK 순서: user → tenant)
    await dbPool.query('DELETE FROM users WHERE id = $1', [body.user.id]).catch(() => {})
    await dbPool.query('DELETE FROM tenants WHERE id = $1', [decoded.orgId]).catch(() => {})
  })

  it('register → login → refresh → logout → me 전체 흐름', async () => {
    // 1. register
    const regRes = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email, password },
    })
    expect(regRes.statusCode).toBe(201)
    const regBody = regRes.json() as { user: { id: string }; accessToken: string; refreshToken: string }
    expect(regBody.user.id).toBeTruthy()
    const { refreshToken: rt1 } = regBody

    // 2. login — 두 번째 로그인은 새 refresh token 발급
    const loginRes = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email, password },
    })
    expect(loginRes.statusCode).toBe(200)
    const { accessToken, refreshToken: rt2 } = loginRes.json() as { accessToken: string; refreshToken: string }
    expect(accessToken).toBeTruthy()
    expect(rt2).toBeTruthy()
    expect(rt1).not.toBe(rt2)

    // 3. /me — access token으로 사용자 조회
    const meRes = await app.inject({
      method: 'GET', url: '/auth/me',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(meRes.statusCode).toBe(200)
    expect((meRes.json() as { user: { email: string } }).user.email).toBe(email)

    // 4. refresh — rotation으로 새 토큰 발급
    const refreshRes = await app.inject({
      method: 'POST', url: '/auth/refresh',
      payload: { refreshToken: rt2 },
    })
    expect(refreshRes.statusCode).toBe(200)
    const { refreshToken: rt3 } = refreshRes.json() as { accessToken: string; refreshToken: string }
    expect(rt3).not.toBe(rt2)

    // 5. logout
    const logoutRes = await app.inject({
      method: 'POST', url: '/auth/logout',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(logoutRes.statusCode).toBe(200)
    expect((logoutRes.json() as { ok: boolean }).ok).toBe(true)
  })
})
