import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * G10 (W14): sessions 비용 write 엔드포인트 rate-limit.
 * POST messages는 LLM 호출/decompose_request를 트리거하므로 스팸 시 비용 폭발·DoS. auth-rate-limit.test.ts 미러.
 * 각 it가 fresh 서버(fresh rate-limit store) + invalid input(400 fast·Redis/Manager 무접촉)로 hermetic.
 */

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

import { buildServer } from '../server.js'

const BASE_CONFIG = {
  port: 0,
  redisUrl: 'redis://127.0.0.1:6380',
  managerUrl: 'http://localhost:3001',
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

/** maxAllowed회는 통과(400 등 비-429), 다음 요청은 429. rate-limit은 onRequest라 handler 400과 무관하게 카운트. */
async function assertRateLimited(
  app: FastifyInstance,
  url: string,
  payload: string,
  clientIp: string,
  maxAllowed: number,
): Promise<void> {
  const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp }
  for (let i = 0; i < maxAllowed; i++) {
    const res = await app.inject({ method: 'POST', url, headers, payload })
    expect(res.statusCode).not.toBe(429) // 상한 이내는 429 아님(400/기타 허용)
  }
  const res = await app.inject({ method: 'POST', url, headers, payload })
  expect(res.statusCode).toBe(429)
  expect((res.json() as { error: string }).error).toBe('Too Many Requests')
}

describe('Sessions 비용 write rate limiting (G10·W14)', () => {
  let app: FastifyInstance
  afterEach(async () => { await app?.close() })

  it('POST /sessions — 11회째 429(상한 10/min·invalid body로 400 fast)', async () => {
    app = await startServer()
    // userId 비문자열 → handler safeParse 400(세션 생성·publish 전). rate-limit onRequest가 먼저 카운트.
    await assertRateLimited(app, '/sessions', JSON.stringify({ userId: 123 }), '10.1.0.1', 10)
  })

  it('POST /sessions/:id/messages — 31회째 429(상한 30/min·invalid UUID로 400 fast)', async () => {
    app = await startServer()
    // invalid UUID → resolveSession 400(producer/Redis 무접촉).
    await assertRateLimited(app, '/sessions/not-a-uuid/messages', JSON.stringify({ content: 'x' }), '10.1.0.2', 30)
  })

  it('POST /sessions/:id/ui-actions — 61회째 429(상한 60/min·invalid UUID로 400 fast)', async () => {
    app = await startServer()
    await assertRateLimited(app, '/sessions/not-a-uuid/ui-actions', JSON.stringify({ action: 'x', data: {} }), '10.1.0.3', 60)
  })
})
