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
  ProjectGatewayConsumer: vi.fn().mockImplementation(function () { return ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }) }),
}))

vi.mock('../auth/user.repo.js', () => ({
  UserRepo: vi.fn().mockImplementation(function () { return ({
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', displayName: null, passwordHash: 'h', createdAt: new Date() }),
    findById: vi.fn().mockResolvedValue(null),
  }) }),
  toPublic: vi.fn((u) => u),
}))

vi.mock('../auth/refresh.repo.js', () => ({
  RefreshRepo: vi.fn().mockImplementation(function () { return ({
    create: vi.fn().mockResolvedValue(undefined),
    findValid: vi.fn().mockResolvedValue(null),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  }) }),
}))

vi.mock('../auth/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('$argon2id$hashed'),
  verifyPassword: vi.fn().mockResolvedValue(false),
}))

import { buildServer } from '../server.js'

const BASE_CONFIG = {
  port: 0,
  redisUrl: 'redis://127.0.0.1:6380',
  managerUrl: 'http://localhost:3001',
  claudeMode: 'cli' as const,
  mode: 'local' as const,
  auth: 'none' as const,
  allowedOrigins: [],
  trustProxy: false,
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

/**
 * **X-Forwarded-For 로 rate limit 을 우회할 수 있는가.**
 *
 * `@fastify/rate-limit` 의 기본 키는 `req.ip` 다. 그리고 `req.ip` 가 소켓 주소인지
 * `X-Forwarded-For` 인지는 **Fastify 의 `trustProxy` 하나가 결정한다.**
 *
 * 이전 판은 `trustProxy: true` 를 하드코딩했다. 프록시 뒤가 아니면 그 헤더는
 * 클라이언트가 임의로 쓰는 값이므로, 매 요청 다른 값을 넣으면 매번 새 버킷이 잡혀
 * 로그인 시도 제한이 통째로 무력화된다. 브루트포스 방어가 헤더 한 줄로 사라진다.
 *
 * 그래서 기본값을 false 로 되돌리고, 프록시 뒤 배포에서만 명시로 켠다.
 */
describe('rate limit 키와 trustProxy', () => {
  let app: FastifyInstance

  afterEach(async () => { await app?.close() })

  async function loginWithRotatingXff(instance: FastifyInstance, count: number): Promise<number[]> {
    const codes: number[] = []
    for (let i = 0; i < count; i++) {
      const res = await instance.inject({
        method: 'POST', url: '/auth/login',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `203.0.113.${i + 1}` },
        payload: JSON.stringify({ email: 'test@test.com', password: 'wrongpass' }),
      })
      codes.push(res.statusCode)
    }
    return codes
  }

  it('trustProxy 기본값(false)에서 X-Forwarded-For 를 매 요청 바꿔도 6번째는 429다', async () => {
    app = await startServer()
    const codes = await loginWithRotatingXff(app, 6) // NOSONAR — max:5 라 6번째가 경계
    expect(codes[5]).toBe(429)
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true)
  })

  it('trustProxy=true 를 명시하면 X-Forwarded-For 별로 버킷이 갈린다 — 프록시 뒤 배포용', async () => {
    // 프록시 뒤에서는 소켓 주소가 전부 프록시 IP라 이 스위치가 없으면 **전체 사용자가
    // 버킷 하나를 공유한다** — 한 명이 5회 틀리면 나머지 전원이 잠긴다.
    app = await buildServer(
      { ...BASE_CONFIG, trustProxy: true },
      { async *send() { yield { type: 'done' as const, content: '' } } },
    )
    const codes = await loginWithRotatingXff(app, 6) // NOSONAR
    expect(codes.includes(429)).toBe(false)
  })
})
