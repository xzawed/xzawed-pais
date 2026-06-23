import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import type { StreamProducer } from '../streams/producer.js'
import { sessionsRoutes } from '../api/sessions.route.js'
import { InMemorySessionStore } from '../sessions/session.store.js'

vi.mock('../streams/consumer.js', () => ({
  StreamConsumer: vi.fn().mockImplementation(function () { return ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }) }),
}))

async function buildApp(decomposeEnabled: boolean) {
  const app = Fastify()
  const publish = vi.fn().mockResolvedValue(undefined)
  await app.register(sessionsRoutes, {
    store: new InMemorySessionStore(),
    runner: { async *send() { yield { type: 'done', content: '' } } },
    wsSessions: new Map(),
    redisUrl: 'redis://127.0.0.1:6380',
    producer: { publish, publishSessionGateway: vi.fn().mockResolvedValue(undefined) } as unknown as StreamProducer,
    sessionConsumers: new Map(),
    sessionCleanup: new Map(),
    decomposeEnabled,
  })
  return { app, publish }
}

async function createSession(app: Awaited<ReturnType<typeof buildApp>>['app']): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/sessions', payload: {} })
  return (res.json() as { sessionId: string }).sessionId
}

describe('C6 intake 라우터 — build 모드', () => {
  it('mode=build + decomposeEnabled → decompose_request 발행(intent=content)', async () => {
    const { app, publish } = await buildApp(true)
    const sid = await createSession(app)
    await app.inject({ method: 'POST', url: `/sessions/${sid}/messages`, payload: { content: 'build a todo app', mode: 'build' } })
    await new Promise(r => setTimeout(r, 80))
    const decompose = publish.mock.calls.map(c => c[0]).find((m: { type: string }) => m.type === 'decompose_request')
    expect(decompose).toBeTruthy()
    expect((decompose as { payload: { intent: string } }).payload.intent).toBe('build a todo app')
  })

  it('decomposeEnabled=false + mode=build → task_request 폴백(decompose 미발행)', async () => {
    const { app, publish } = await buildApp(false)
    const sid = await createSession(app)
    await app.inject({ method: 'POST', url: `/sessions/${sid}/messages`, payload: { content: 'x', mode: 'build' } })
    await new Promise(r => setTimeout(r, 80))
    const types = publish.mock.calls.map(c => (c[0] as { type: string }).type)
    expect(types).toContain('task_request')
    expect(types).not.toContain('decompose_request')
  })
})
