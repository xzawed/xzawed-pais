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

vi.mock('../auth/user.repo.js', () => ({
  UserRepo: vi.fn().mockImplementation(() => ({
    findByEmail: mockFindByEmail,
    findById: mockFindById,
    create: mockCreate,
  })),
  toPublic: vi.fn((u) => ({ id: u.id, email: u.email, displayName: u.displayName })),
}))

vi.mock('../auth/refresh.repo.js', () => ({
  RefreshRepo: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    findValid: vi.fn().mockResolvedValue(null),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../auth/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('$argon2id$hashed'),
  verifyPassword: vi.fn().mockResolvedValue(true),
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

import { buildServer } from '../server.js'

const BASE_CONFIG = {
  port: 0,
  redisUrl: 'redis://127.0.0.1:6380',
  managerUrl: 'http://127.0.0.1:9999',
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
    vi.clearAllMocks()
  })

  it('유효한 토큰 — 새 accessToken + refreshToken 반환', async () => {
    // BEGIN → rows ok → user found → UPDATE → INSERT → COMMIT
    mockClientQuery
      .mockResolvedValueOnce(undefined)                           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'rt-1', user_id: 'user-1' }] })  // SELECT FOR UPDATE
      .mockResolvedValueOnce(undefined)                           // UPDATE revoke
      .mockResolvedValueOnce(undefined)                           // INSERT new token
      .mockResolvedValueOnce(undefined)                           // COMMIT
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

  it('유효한 토큰이지만 사용자를 찾을 수 없음 — 401 + ROLLBACK', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined)                           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'rt-1', user_id: 'user-1' }] })  // SELECT FOR UPDATE
      .mockResolvedValueOnce(undefined)                           // ROLLBACK
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
    mockClientQuery
      .mockResolvedValueOnce(undefined)                           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'rt-1', user_id: 'user-1' }] })  // SELECT FOR UPDATE
    mockFindById.mockRejectedValue(new Error('DB connection lost'))
    mockClientQuery.mockResolvedValueOnce(undefined)              // ROLLBACK

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
