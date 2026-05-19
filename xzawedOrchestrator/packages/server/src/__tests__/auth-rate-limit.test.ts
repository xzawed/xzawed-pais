import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) }

vi.mock('../db/pool.js', () => ({
  createPool: vi.fn(() => mockPool),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  closePool: vi.fn().mockResolvedValue(undefined),
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
  const app = await buildServer(
    BASE_CONFIG,
    { async *send() { yield { type: 'done' as const, content: '' } } }
  )
  return app
}

describe('Auth rate limiting', () => {
  let app: FastifyInstance

  afterEach(async () => { await app?.close() })

  it('POST /auth/register — 6회 연속 시 429 반환', async () => {
    app = await startServer()

    const body = JSON.stringify({ email: 'test@test.com', password: 'password123' })
    const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1' }

    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/auth/register', headers, payload: body })
    }
    const res = await app.inject({ method: 'POST', url: '/auth/register', headers, payload: body })
    expect(res.statusCode).toBe(429)
    expect((res.json() as { error: string }).error).toBe('Too Many Requests')
  })

  it('POST /auth/login — 6회 연속 시 429 반환', async () => {
    app = await startServer()

    const body = JSON.stringify({ email: 'test@test.com', password: 'wrongpass' })
    const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.2' }

    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/auth/login', headers, payload: body })
    }
    const res = await app.inject({ method: 'POST', url: '/auth/login', headers, payload: body })
    expect(res.statusCode).toBe(429)
    expect((res.json() as { error: string }).error).toBe('Too Many Requests')
  })

  it('POST /auth/refresh — 21회 연속 시 429 반환', async () => {
    app = await startServer()

    const body = JSON.stringify({ refreshToken: 'invalid' })
    const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.3' }

    for (let i = 0; i < 20; i++) {
      await app.inject({ method: 'POST', url: '/auth/refresh', headers, payload: body })
    }
    const res = await app.inject({ method: 'POST', url: '/auth/refresh', headers, payload: body })
    expect(res.statusCode).toBe(429)
  })
})
