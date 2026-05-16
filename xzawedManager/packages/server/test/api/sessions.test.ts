import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { sessionsRoute } from '../../src/api/sessions.route.js'
import { SessionStore } from '../../src/sessions/session.store.js'

const mockConsumerStart = vi.fn().mockResolvedValue(undefined)
const mockConsumerStop = vi.fn()

vi.mock('../../src/streams/consumer.js', () => ({
  StreamConsumer: class {
    start = mockConsumerStart
    stop = mockConsumerStop
    ensureGroup = vi.fn().mockResolvedValue(undefined)
  },
}))

describe('POST /api/sessions/:sessionId/start', () => {
  it('returns 202 with sessionId and status started', async () => {
    const mockRun = vi.fn().mockResolvedValue('Task complete')
    const mockPublish = vi.fn().mockResolvedValue('1234-0')
    const sessionStore = new SessionStore()

    const app = Fastify()
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: mockRun } as never,
      producer: { publish: mockPublish } as never,
      sessionStore,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/sess-1/start',
    })

    expect(response.statusCode).toBe(202)
    expect(JSON.parse(response.body)).toEqual({ sessionId: 'sess-1', status: 'started' })
  })

  it('returns 409 when session is already active', async () => {
    const app = Fastify()
    const sessionStore = new SessionStore()
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: vi.fn() } as never,
      producer: { publish: vi.fn() } as never,
      sessionStore,
    })

    await app.inject({ method: 'POST', url: '/api/sessions/sess-dup/start' })
    const response = await app.inject({ method: 'POST', url: '/api/sessions/sess-dup/start' })

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body)).toMatchObject({ error: 'Session already active' })
  })
})
