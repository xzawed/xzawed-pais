import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test',
  passwordHash: '$argon2id$hashed',
  createdAt: new Date(),
}

const mockFindByEmail = vi.fn()
const mockFindById = vi.fn()
const mockCreate = vi.fn()

const { mockVerifyPassword, mockHashPassword } = vi.hoisted(() => ({
  mockVerifyPassword: vi.fn().mockResolvedValue(true),
  mockHashPassword: vi.fn().mockResolvedValue('$argon2id$hashed'),
}))

vi.mock('../auth/user.repo.js', () => ({
  UserRepo: vi.fn().mockImplementation(() => ({
    findByEmail: mockFindByEmail,
    findById: mockFindById,
    create: mockCreate,
  })),
  toPublic: vi.fn((u) => ({ id: u.id, email: u.email, displayName: u.displayName })),
}))

const mockRefreshFindValid = vi.fn<(token: string, client?: unknown) => Promise<{ id: string; userId: string } | undefined>>()
const mockRefreshCreate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockRefreshRevokeAllForUser = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockRefreshRevokeByToken = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockRefreshCountByUser = vi.fn<() => Promise<number>>().mockResolvedValue(0)
const mockRefreshRevokeOldestByUser = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

vi.mock('../auth/refresh.repo.js', () => ({
  RefreshRepo: vi.fn().mockImplementation(() => ({
    create: mockRefreshCreate,
    findValid: mockRefreshFindValid,
    revokeAllForUser: mockRefreshRevokeAllForUser,
    revokeByToken: mockRefreshRevokeByToken,
    countByUser: mockRefreshCountByUser,
    revokeOldestByUser: mockRefreshRevokeOldestByUser,
  })),
}))

vi.mock('../auth/password.js', () => ({
  hashPassword: mockHashPassword,
  verifyPassword: mockVerifyPassword,
}))

const mockClientQuery = vi.fn()
const mockClientRelease = vi.fn()
const mockClient = {
  query: mockClientQuery,
  release: mockClientRelease,
}
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn().mockResolvedValue(mockClient),
}

vi.mock('../db/pool.js', () => ({
  createPool: vi.fn(() => mockPool),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  closePool: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../projects/project-gateway.js', () => ({
  ProjectGatewayConsumer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  })),
}))

import { buildServer } from '../server.js'
import { issueAccessToken } from '../auth/tokens.js'

const BASE_CONFIG = {
  port: 0,
  redisUrl: 'redis://127.0.0.1:6380',
  claudeMode: 'cli' as const,
  mode: 'local' as const,
  auth: 'none' as const,
  claudeModel: 'test',
  serveWeb: false,
  databaseUrl: 'postgres://test:test@localhost:5432/test',
  userJwtSecret: 'test-secret-key-that-is-long-enough-32ch',
}

async function startServer(): Promise<FastifyInstance> {
  return buildServer(
    BASE_CONFIG,
    { async *send() { yield { type: 'done' as const, content: '' } } },
  )
}

describe('POST /auth/register — email validation', () => {
  let app: FastifyInstance

  afterEach(async () => { await app?.close() })

  it('잘못된 이메일 형식 — 400 반환', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'password123' },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toContain('email')
  })

  it('@가 없는 이메일 — 400 반환', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'nodomain.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /auth/refresh — TOCTOU 트랜잭션', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
    mockClientQuery.mockReset()
    mockClientRelease.mockReset()
    mockFindById.mockReset()
    mockRefreshFindValid.mockReset()
    vi.clearAllMocks()
  })

  it('유효한 토큰 — 새 accessToken + refreshToken 반환', async () => {
    // findValid(token, client) returns record → UPDATE → INSERT → COMMIT
    mockRefreshFindValid.mockResolvedValueOnce({ id: 'rt-1', userId: 'user-1' })
    mockClientQuery
      .mockResolvedValueOnce(undefined)  // BEGIN
      .mockResolvedValueOnce(undefined)  // UPDATE revoke
      .mockResolvedValueOnce(undefined)  // INSERT new token
      .mockResolvedValueOnce(undefined)  // COMMIT
    mockFindById.mockResolvedValue(mockUser)

    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'valid-token-string' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { accessToken: string; refreshToken: string }
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(mockClientRelease).toHaveBeenCalled()
  })

  it('유효하지 않은 토큰 — 401 + ROLLBACK', async () => {
    // findValid returns undefined → ROLLBACK → 401
    mockRefreshFindValid.mockResolvedValueOnce(undefined)
    mockClientQuery
      .mockResolvedValueOnce(undefined)  // BEGIN
      .mockResolvedValueOnce(undefined)  // ROLLBACK

    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'invalid-token' },
    })
    expect(res.statusCode).toBe(401)
    expect((res.json() as { error: string }).error).toContain('Invalid or expired')
    expect(mockClientRelease).toHaveBeenCalled()
  })

  it('유효한 토큰이지만 사용자를 찾을 수 없음 — 401 + ROLLBACK', async () => {
    mockRefreshFindValid.mockResolvedValueOnce({ id: 'rt-1', userId: 'user-1' })
    mockClientQuery
      .mockResolvedValueOnce(undefined)  // BEGIN
      .mockResolvedValueOnce(undefined)  // ROLLBACK
    mockFindById.mockResolvedValue(null)

    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'valid-but-orphaned-token' },
    })
    expect(res.statusCode).toBe(401)
    expect((res.json() as { error: string }).error).toContain('User not found')
    expect(mockClientRelease).toHaveBeenCalled()
  })

  it('refreshToken 미제공 — 400 반환', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('트랜잭션 예외 시 ROLLBACK + release 보장', async () => {
    mockRefreshFindValid.mockResolvedValueOnce({ id: 'rt-1', userId: 'user-1' })
    mockClientQuery
      .mockResolvedValueOnce(undefined)   // BEGIN
      .mockResolvedValueOnce(undefined)   // ROLLBACK
    mockFindById.mockRejectedValue(new Error('DB connection lost'))

    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'any-token' },
    })
    expect(res.statusCode).toBe(500)
    expect(mockClientRelease).toHaveBeenCalled()
  })
})

describe('POST /auth/register — 필드 누락·비밀번호 검증', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
    mockFindByEmail.mockReset()
    mockCreate.mockReset()
  })

  it('이메일 없음 — 400 반환', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { password: 'password123' },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toContain('email')
  })

  it('비밀번호 없음 — 400 반환', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'user@example.com' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('비밀번호 8자 미만 — 400 반환', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'user@example.com', password: 'short' },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toContain('8')
  })

  it('이메일 중복 — 409 반환', async () => {
    mockFindByEmail.mockResolvedValueOnce(mockUser)
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'test@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { error: string }).error).toContain('already')
  })

  it('등록 성공 — 201 + 토큰 반환', async () => {
    mockFindByEmail.mockResolvedValueOnce(undefined)
    mockCreate.mockResolvedValueOnce(mockUser)
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'new@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { user: { id: string }; accessToken: string; refreshToken: string }
    expect(body.user.id).toBe('user-1')
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
  })
})

describe('POST /auth/login', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
    mockFindByEmail.mockReset()
    mockVerifyPassword.mockReset()
    mockVerifyPassword.mockResolvedValue(true)
    vi.clearAllMocks()
  })

  it('이메일 없음 — 400 반환', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'password123' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('비밀번호 없음 — 400 반환', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@example.com' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('잘못된 비밀번호 — 401 반환', async () => {
    mockFindByEmail.mockResolvedValueOnce(mockUser)
    mockVerifyPassword.mockResolvedValueOnce(false)
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'test@example.com', password: 'wrongpass' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('로그인 성공 — 200 반환', async () => {
    mockFindByEmail.mockResolvedValueOnce(mockUser)
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'test@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { accessToken: string; refreshToken: string }
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
  })

  it('사용자 없음 — 401 반환', async () => {
    // mockFindByEmail returns undefined after mockReset in afterEach
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'notfound@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('로그인 성공 시 세션 수 5 이상이면 oldest revoke 후 새 토큰 생성', async () => {
    mockFindByEmail.mockResolvedValueOnce(mockUser)
    mockRefreshCountByUser.mockResolvedValueOnce(5)
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'test@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    expect(mockRefreshRevokeOldestByUser).toHaveBeenCalledTimes(1)
    expect(mockRefreshCreate).toHaveBeenCalledTimes(1)
  })
})

describe('POST /auth/logout + GET /auth/me', () => {
  let app: FastifyInstance
  const SECRET = BASE_CONFIG.userJwtSecret!
  const getToken = () => issueAccessToken(
    { sub: 'user-1', email: 'test@example.com', displayName: 'Test' },
    SECRET,
  )

  afterEach(async () => {
    await app?.close()
    mockFindById.mockReset()
    vi.clearAllMocks()
  })

  it('logout — 인증 토큰 있음 — 200 반환', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { ok: boolean }).ok).toBe(true)
  })

  it('logout — 토큰 없음 — 401 반환', async () => {
    app = await startServer()
    const res = await app.inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(401)
  })

  it('logout — refreshToken 포함 시 해당 토큰만 revoke (revokeByToken 1회 호출)', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { Authorization: `Bearer ${getToken()}` },
      payload: { refreshToken: 'some-refresh-token-value' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { ok: boolean }).ok).toBe(true)
    expect(mockRefreshRevokeByToken).toHaveBeenCalledTimes(1)
    expect(mockRefreshRevokeAllForUser).not.toHaveBeenCalled()
  })

  it('logout — refreshToken 없으면 전체 revoke (revokeAllForUser 1회 호출)', async () => {
    app = await startServer()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { Authorization: `Bearer ${getToken()}` },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { ok: boolean }).ok).toBe(true)
    expect(mockRefreshRevokeAllForUser).toHaveBeenCalledTimes(1)
    expect(mockRefreshRevokeByToken).not.toHaveBeenCalled()
  })

  it('/me — 사용자 조회 성공 — 200 반환', async () => {
    mockFindById.mockResolvedValue(mockUser)
    app = await startServer()
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { user: { id: string } }).user.id).toBe('user-1')
  })

  it('/me — 사용자 없음 — 404 반환', async () => {
    mockFindById.mockResolvedValue(null)
    app = await startServer()
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('/me — 토큰 없음 — 401 반환', async () => {
    app = await startServer()
    const res = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(res.statusCode).toBe(401)
  })
})
