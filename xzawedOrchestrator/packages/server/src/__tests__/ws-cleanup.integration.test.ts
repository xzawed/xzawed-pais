import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

// Short grace so the "cleanup after grace" path is observable quickly in tests.
async function startServer(graceMs = 100): Promise<{ app: FastifyInstance; port: number }> {
  const app = await buildServer(
    { port: 0, redisUrl: 'redis://127.0.0.1:6380', managerUrl: 'http://localhost:3001', claudeMode: 'cli', mode: 'local', auth: 'none', claudeModel: 'test', serveWeb: false, wsCleanupGraceMs: graceMs },
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

async function createSession(port: number, userId = 'cleanup-user'): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  })
  return ((await res.json()) as { sessionId: string }).sessionId
}

function messagesStatus(port: number, sessionId: string): Promise<number> {
  return fetch(`http://127.0.0.1:${port}/sessions/${sessionId}/messages`).then((r) => r.status)
}

describe('WebSocket session cleanup', () => {
  let app: FastifyInstance

  // Reset recorded mock results between tests so each test inspects only the
  // StreamConsumer instance it creates (results otherwise accumulate file-wide).
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await app?.close()
  })

  it('WS 끊김 후 grace 기간 내에는 세션이 유지되고, grace 경과 후 정리된다', async () => {
    let port: number
    ;({ app, port } = await startServer(250))

    const sessionId = await createSession(port)
    expect(await messagesStatus(port, sessionId)).toBe(200)

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sessionId}`)
    await new Promise<void>((r) => ws.on('open', r))
    ws.close()

    // Within the grace window: a transient disconnect must NOT destroy the session.
    await delay(30)
    expect(await messagesStatus(port, sessionId)).toBe(200)

    // After the grace window with no reconnect: the session is reaped.
    await delay(400)
    expect(await messagesStatus(port, sessionId)).toBe(404)
  })

  it('grace 기간 내 재연결 시 정리가 취소되어 세션이 유지된다', async () => {
    let port: number
    ;({ app, port } = await startServer(250))

    const sessionId = await createSession(port)

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sessionId}`)
    await new Promise<void>((r) => ws1.on('open', r))
    ws1.close()

    // Reconnect well within the grace window (simulates StrictMode remount).
    await delay(30)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sessionId}`)
    await new Promise<void>((r) => ws2.on('open', r))

    // Wait past the original grace deadline: reconnect must have cancelled the pending cleanup.
    await delay(400)
    expect(await messagesStatus(port, sessionId)).toBe(200)

    ws2.close()
  })

  it('WS 끊김 시 StreamConsumer.stop은 grace 경과 후에 호출된다', async () => {
    let port: number
    ;({ app, port } = await startServer(250))

    const sessionId = await createSession(port, 'consumer-user')

    const MockConsumer = vi.mocked(StreamConsumer)
    const consumerInstance = MockConsumer.mock.results.find(
      (r) => r.type === 'return'
    )?.value as { stop: ReturnType<typeof vi.fn> } | undefined
    expect(consumerInstance).toBeDefined()

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sessionId}`)
    await new Promise<void>((r) => ws.on('open', r))
    ws.close()

    // Within grace: consumer kept running for a possible reconnect.
    await delay(30)
    expect(consumerInstance?.stop).not.toHaveBeenCalled()

    // After grace: consumer is stopped as part of the deferred teardown.
    await delay(400)
    expect(consumerInstance?.stop).toHaveBeenCalled()
  })

  it('WS 끊김은 다른 활성 세션에 영향을 주지 않는다 (끊긴 세션만 grace 후 정리)', async () => {
    let port: number
    ;({ app, port } = await startServer(250))

    const sid1 = await createSession(port, 'multi-user')
    const sid2 = await createSession(port, 'multi-user')

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sid1}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sid2}`)
    await Promise.all([
      new Promise<void>((r) => ws1.on('open', r)),
      new Promise<void>((r) => ws2.on('open', r)),
    ])

    // Close only session 1, then wait past the grace window.
    ws1.close()
    await delay(400)

    // Session 1 reaped after grace; session 2 (still connected) untouched.
    expect(await messagesStatus(port, sid1)).toBe(404)
    expect(await messagesStatus(port, sid2)).toBe(200)

    ws2.close()
  })

  it('존재하지 않는 sessionId로 WS 연결 시 정상 종료가 아닌 코드로 닫힌다', async () => {
    let port: number
    ;({ app, port } = await startServer())

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
    let port: number
    ;({ app, port } = await startServer())

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/not-a-uuid`)

    const closeCode = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
      ws.on('error', () => resolve(1006))
    })

    expect(closeCode).not.toBe(1000)
  })

  it('HTTP /sessions/:id/messages — UUID 아닌 ID는 400을 반환한다', async () => {
    let port: number
    ;({ app, port } = await startServer())

    const res = await fetch(`http://127.0.0.1:${port}/sessions/not-a-uuid/messages`)
    expect(res.status).toBe(400)
  })
})
