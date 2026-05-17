import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Chunk, Message } from '@xzawed/shared'
import WebSocket from 'ws'
import type { FastifyInstance } from 'fastify'

vi.mock('../streams/consumer.js', () => ({
  StreamConsumer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  })),
}))

vi.mock('../streams/producer.js', () => ({
  StreamProducer: vi.fn().mockImplementation(() => ({
    publish: vi.fn().mockRejectedValue(new Error('no redis in test')),
  })),
}))

vi.mock('../manager/manager.client.js', () => ({
  ManagerClient: vi.fn().mockImplementation(() => ({
    startSession: vi.fn().mockRejectedValue(new Error('no manager in test')),
  })),
}))

import { buildServer } from '../server.js'
import type { ClaudeRunner, RunOptions } from '../claude/runner.interface.js'

function makeMockRunner(chunks: Chunk[]): ClaudeRunner {
  return {
    async *send(_messages: Message[], _options: RunOptions): AsyncIterable<Chunk> {
      for (const c of chunks) yield c
    },
  }
}

async function startServer(runner: ClaudeRunner): Promise<{ app: FastifyInstance; port: number }> {
  const app = await buildServer(
    { port: 0, redisUrl: 'redis://127.0.0.1:6380', managerUrl: 'http://127.0.0.1:9999', claudeMode: 'cli', mode: 'local', auth: 'none', claudeModel: 'test' },
    runner
  )
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { app, port }
}

function wsConnect(port: number, sessionId: string): Promise<{ ws: WebSocket; messages: unknown[] }> {
  return new Promise((resolve) => {
    const messages: unknown[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sessionId}`)
    ws.on('message', (raw) => {
      const buf = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as Buffer | ArrayBuffer)
      messages.push(JSON.parse(buf.toString()))
    })
    ws.on('open', () => resolve({ ws, messages }))
  })
}

function waitForWsMessage(messages: unknown[], predicate: (m: unknown) => boolean, timeout = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('timeout waiting for WS message')), timeout)
    const check = setInterval(() => {
      if (messages.some(predicate)) {
        clearInterval(check)
        clearTimeout(deadline)
        resolve()
      }
    }, 10)
  })
}

async function createConnectedSession(port: number): Promise<{ sessionId: string; ws: WebSocket; messages: unknown[] }> {
  const res = await fetch(`http://127.0.0.1:${port}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'u1' }),
  })
  const { sessionId } = (await res.json()) as { sessionId: string }
  const { ws, messages } = await wsConnect(port, sessionId)
  await waitForWsMessage(messages, (m) => (m as { type: string }).type === 'connected')
  return { sessionId, ws, messages }
}

async function postMessage(port: number, sessionId: string, content: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

describe('sessions route integration', () => {
  let app: FastifyInstance
  let port: number

  afterEach(async () => {
    await app?.close()
  })

  it('POST /sessions returns 201 with sessionId', async () => {
    ;({ app, port } = await startServer(makeMockRunner([])))

    const res = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'test-user' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { sessionId: string }
    expect(typeof body.sessionId).toBe('string')
  })

  it('GET /sessions/:id/messages returns 404 for unknown session', async () => {
    ;({ app, port } = await startServer(makeMockRunner([])))

    const res = await fetch(`http://127.0.0.1:${port}/sessions/does-not-exist/messages`)
    expect(res.status).toBe(404)
  })

  it('WebSocket /ws/sessions/:id sends connected on connect', async () => {
    ;({ app, port } = await startServer(makeMockRunner([])))
    const { sessionId, ws, messages } = await createConnectedSession(port)
    try {
      const connected = messages.find((m) => (m as { type: string }).type === 'connected') as { sessionId: string }
      expect(connected.sessionId).toBe(sessionId)
    } finally {
      ws.close()
    }
  })

  it('WebSocket receives chunk and done after POST message', async () => {
    const runner = makeMockRunner([
      { type: 'text', content: 'Hello' },
      { type: 'text', content: ' world' },
      { type: 'done', content: '' },
    ])
    ;({ app, port } = await startServer(runner))
    const { sessionId, ws, messages } = await createConnectedSession(port)

    const msgRes = await postMessage(port, sessionId, 'hi')
    expect(msgRes.status).toBe(202)
    await waitForWsMessage(messages, (m) => (m as { type: string }).type === 'done')

    expect(messages.filter((m) => (m as { type: string }).type === 'chunk')).toHaveLength(2)
    expect(messages.find((m) => (m as { type: string }).type === 'done')).toBeDefined()
    ws.close()
  })

  it('WebSocket receives error message when runner yields error', async () => {
    const runner = makeMockRunner([{ type: 'error', content: 'something failed' }])
    ;({ app, port } = await startServer(runner))
    const { sessionId, ws, messages } = await createConnectedSession(port)

    await postMessage(port, sessionId, 'hi')
    await waitForWsMessage(messages, (m) => (m as { type: string }).type === 'error')

    const errMsg = messages.find((m) => (m as { type: string }).type === 'error') as { content: string }
    expect(errMsg.content).toBe('something failed')
    ws.close()
  })

  it('streamed content is stored as assistant message', async () => {
    const runner = makeMockRunner([
      { type: 'text', content: 'The answer' },
      { type: 'done', content: '' },
    ])
    ;({ app, port } = await startServer(runner))
    const { sessionId, ws, messages } = await createConnectedSession(port)

    await postMessage(port, sessionId, 'question')
    await waitForWsMessage(messages, (m) => (m as { type: string }).type === 'done')

    const historyRes = await fetch(`http://127.0.0.1:${port}/sessions/${sessionId}/messages`)
    const history = (await historyRes.json()) as Array<{ role: string; content: string }>
    expect(history.find((m) => m.role === 'assistant')?.content).toBe('The answer')
    ws.close()
  })

  it('GET /sessions/:id/tasks returns 404 for unknown session', async () => {
    ;({ app, port } = await startServer(makeMockRunner([])))
    const res = await fetch(`http://127.0.0.1:${port}/sessions/does-not-exist/tasks`)
    expect(res.status).toBe(404)
  })

  it('GET /sessions/:id/tasks returns pending task after message send', async () => {
    const runner = makeMockRunner([
      { type: 'text', content: 'OK, I will build the feature' },
      { type: 'done', content: '' },
    ])
    ;({ app, port } = await startServer(runner))
    const { sessionId, ws, messages } = await createConnectedSession(port)

    await postMessage(port, sessionId, 'Build a feature')
    await waitForWsMessage(messages, (m) => (m as { type: string }).type === 'done')

    const tasksRes = await fetch(`http://127.0.0.1:${port}/sessions/${sessionId}/tasks`)
    expect(tasksRes.status).toBe(200)
    const body = (await tasksRes.json()) as { tasks: Array<{ status: string; intent: string }> }
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].status).toBe('pending')
    expect(body.tasks[0].intent).toContain('OK, I will build the feature')
    ws.close()
  })
})
