import { describe, it, expect, vi, afterEach } from 'vitest'
import WebSocket from 'ws'
import type { FastifyInstance } from 'fastify'

vi.mock('../streams/consumer.js', () => ({
  StreamConsumer: vi.fn().mockImplementation(function () { return ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }) }),
}))

vi.mock('../streams/producer.js', () => ({
  StreamProducer: vi.fn().mockImplementation(function () { return ({
    publish: vi.fn().mockRejectedValue(new Error('no redis in test')),
    publishSessionGateway: vi.fn().mockRejectedValue(new Error('no redis in test')),
  }) }),
}))

import { buildServer } from '../server.js'
import { StreamConsumer } from '../streams/consumer.js'

async function startServer(): Promise<{ app: FastifyInstance; port: number }> {
  const app = await buildServer(
    { port: 0, redisUrl: 'redis://127.0.0.1:6380', claudeMode: 'cli', mode: 'local', auth: 'none', claudeModel: 'test', serveWeb: false },
    { async *send() { yield { type: 'done' as const, content: '' } } }
  )
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { app, port }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('WebSocket session cleanup', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  it('GET /sessions/:id/messages returns 404 after WS disconnect', async () => {
    ;({ app } = await startServer())
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const sessionRes = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'cleanup-user' }),
    })
    const { sessionId } = (await sessionRes.json()) as { sessionId: string }

    // Verify session exists before disconnect
    const beforeRes = await fetch(`http://127.0.0.1:${port}/sessions/${sessionId}/messages`)
    expect(beforeRes.status).toBe(200)

    // Connect WebSocket then close it
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sessionId}`)
    await new Promise<void>((r) => ws.on('open', r))
    ws.close()

    // Wait for server to process the close event
    await delay(50)

    // Session state should be cleaned up — store.delete was called
    const afterRes = await fetch(`http://127.0.0.1:${port}/sessions/${sessionId}/messages`)
    expect(afterRes.status).toBe(404)
  })

  it('StreamConsumer.stop is called when WebSocket disconnects', async () => {
    ;({ app } = await startServer())
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const sessionRes = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'consumer-user' }),
    })
    const { sessionId } = (await sessionRes.json()) as { sessionId: string }

    // Get the consumer instance created for this session
    const MockConsumer = vi.mocked(StreamConsumer)
    const consumerInstance = MockConsumer.mock.results.find(
      (r) => r.type === 'return'
    )?.value as { stop: ReturnType<typeof vi.fn> } | undefined

    expect(consumerInstance).toBeDefined()

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sessionId}`)
    await new Promise<void>((r) => ws.on('open', r))
    ws.close()

    await delay(50)

    expect(consumerInstance?.stop).toHaveBeenCalled()
  })

  it('WS disconnect does not affect other active sessions', async () => {
    ;({ app } = await startServer())
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const makeSession = async () => {
      const res = await fetch(`http://127.0.0.1:${port}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'multi-user' }),
      })
      return ((await res.json()) as { sessionId: string }).sessionId
    }

    const sid1 = await makeSession()
    const sid2 = await makeSession()

    // Connect both
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sid1}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sid2}`)
    await Promise.all([
      new Promise<void>((r) => ws1.on('open', r)),
      new Promise<void>((r) => ws2.on('open', r)),
    ])

    // Close only session 1
    ws1.close()
    await delay(50)

    // Session 1 cleaned up
    const res1 = await fetch(`http://127.0.0.1:${port}/sessions/${sid1}/messages`)
    expect(res1.status).toBe(404)

    // Session 2 still alive
    const res2 = await fetch(`http://127.0.0.1:${port}/sessions/${sid2}/messages`)
    expect(res2.status).toBe(200)

    ws2.close()
  })

  it('존재하지 않는 sessionId로 WS 연결 시 정상 종료가 아닌 코드로 닫힌다', async () => {
    ;({ app } = await startServer())
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const fakeSessionId = '00000000-0000-0000-0000-000000000000'
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${fakeSessionId}`)

    const closeCode = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
      ws.on('error', () => resolve(1006))
    })

    // 존재하지 않는 세션 → 정상 종료(1000)가 아니어야 함
    expect(closeCode).not.toBe(1000)
  })

  it('UUID 형식이 아닌 sessionId로 WS 연결 시 정상 종료가 아닌 코드로 닫힌다', async () => {
    ;({ app } = await startServer())
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/not-a-uuid`)

    const closeCode = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
      ws.on('error', () => resolve(1006))
    })

    expect(closeCode).not.toBe(1000)
  })

  it('HTTP /sessions/:id/messages — UUID 아닌 ID는 400을 반환한다', async () => {
    ;({ app } = await startServer())
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const res = await fetch(`http://127.0.0.1:${port}/sessions/not-a-uuid/messages`)
    expect(res.status).toBe(400)
  })
})
