import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import jwtPlugin from '@fastify/jwt'
import { sessionsRoute } from '../../src/api/sessions.route.js'
import { SessionStore } from '../../src/sessions/session.store.js'
import { verifyServiceToken } from '../../src/auth/jwt.plugin.js'

vi.mock('../../src/streams/consumer.js', () => ({
  StreamConsumer: class {
    start = vi.fn().mockResolvedValue(undefined)
    stop = vi.fn()
    ensureGroup = vi.fn().mockResolvedValue(undefined)
  },
}))

const TEST_SECRET = 'test-jwt-secret-32-chars-minimum!!'

async function buildAuthApp() {
  const app = Fastify()
  await app.register(jwtPlugin, { secret: TEST_SECRET })
  const sessionStore = new SessionStore()
  await app.register(sessionsRoute, {
    redisUrl: 'redis://localhost:6379',
    runner: { run: vi.fn().mockResolvedValue('done') } as never,
    producer: { publish: vi.fn().mockResolvedValue('1-0') } as never,
    sessionStore,
    authHook: verifyServiceToken,
  })
  return app
}

describe('JWT auth on /api/sessions/:sessionId/start', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const app = await buildAuthApp()
    const res = await app.inject({ method: 'POST', url: '/api/sessions/00000000-0000-0000-0000-000000000001/start' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 401 when token is invalid', async () => {
    const app = await buildAuthApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/00000000-0000-0000-0000-000000000002/start',
      headers: { authorization: 'Bearer invalid.token.here' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 202 when a valid service token is provided', async () => {
    const app = await buildAuthApp()
    await app.ready()
    const token = app.jwt.sign({ service: 'orchestrator' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/00000000-0000-0000-0000-000000000003/start',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(202)
  })

  it('returns 202 without auth when authHook is omitted', async () => {
    const app = Fastify()
    const sessionStore = new SessionStore()
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: vi.fn().mockResolvedValue('done') } as never,
      producer: { publish: vi.fn().mockResolvedValue('1-0') } as never,
      sessionStore,
    })
    const res = await app.inject({ method: 'POST', url: '/api/sessions/00000000-0000-0000-0000-000000000004/start' })
    expect(res.statusCode).toBe(202)
  })
})
