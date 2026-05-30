import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
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

vi.mock('../auth/user.repo.js', () => ({
  UserRepo: vi.fn().mockImplementation(() => ({
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', displayName: null, passwordHash: 'h', createdAt: new Date() }),
    findById: vi.fn().mockResolvedValue(null),
  })),
  toPublic: vi.fn((u) => u),
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
  verifyPassword: vi.fn().mockResolvedValue(false),
}))

import { buildServer } from '../server.js'

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

async function assertRateLimited(
  app: FastifyInstance,
  url: string,
  payload: string,
  clientIp: string,
  maxAllowed: number,
): Promise<void> {
  const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp }
  for (let i = 0; i < maxAllowed; i++) {
    await app.inject({ method: 'POST', url, headers, payload })
  }
  const res = await app.inject({ method: 'POST', url, headers, payload })
  expect(res.statusCode).toBe(429)
  expect((res.json() as { error: string }).error).toBe('Too Many Requests')
}

describe('Auth rate limiting', () => {
  let app: FastifyInstance

  afterEach(async () => { await app?.close() })

  it('POST /auth/register — 6회 연속 시 429 반환', async () => {
    app = await startServer()
    await assertRateLimited(
      app, '/auth/register',
      JSON.stringify({ email: 'test@test.com', password: 'password123' }),
      '10.0.0.1', 5, // NOSONAR
    )
  })

  it('POST /auth/login — 6회 연속 시 429 반환', async () => {
    app = await startServer()
    await assertRateLimited(
      app, '/auth/login',
      JSON.stringify({ email: 'test@test.com', password: 'wrongpass' }),
      '10.0.0.2', 5, // NOSONAR
    )
  })

  it('POST /auth/refresh — 21회 연속 시 429 반환', async () => {
    app = await startServer()
    await assertRateLimited(
      app, '/auth/refresh',
      JSON.stringify({ refreshToken: 'invalid' }),
      '10.0.0.3', 20, // NOSONAR
    )
  })
})

describe('setErrorHandler', () => {
  let app: FastifyInstance

  afterEach(async () => { await app?.close() })

  it('500 에러는 내부 정보 없이 Internal Server Error 반환', async () => {
    app = await startServer()
    app.get('/test-500', async () => {
      throw Object.assign(new Error('DB connection failed: password=secret'), { statusCode: 500 })
    })
    const res = await app.inject({ method: 'GET', url: '/test-500' })
    expect(res.statusCode).toBe(500)
    const body = res.json() as { error: string }
    expect(body.error).toBe('Internal Server Error')
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('400 에러는 error 메시지를 그대로 반환', async () => {
    app = await startServer()
    app.get('/test-400', async () => {
      throw Object.assign(new Error('Bad Request: invalid field'), { statusCode: 400 })
    })
    const res = await app.inject({ method: 'GET', url: '/test-400' })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toBe('Bad Request: invalid field')
  })
})
