import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const mockStart = vi.fn().mockResolvedValue(undefined)
const mockStop = vi.fn()

vi.mock('../../src/streams/consumer.js', () => ({
  StreamConsumer: vi.fn().mockImplementation(function () { return ({
    start: mockStart,
    stop: mockStop,
  }) }),
}))

// Mock StreamProducer before any import of server.ts
const mockPublish = vi.fn().mockResolvedValue('mock-stream-id')
const mockPublishSessionGateway = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/streams/producer.js', () => ({
  StreamProducer: vi.fn().mockImplementation(function () { return ({ publish: mockPublish, publishSessionGateway: mockPublishSessionGateway }) }),
}))

// Mock runner factory to return a controllable stub
const mockSend = vi.fn()
vi.mock('../../src/claude/runner.factory.js', () => ({
  createRunner: vi.fn().mockImplementation(function () { return ({ send: mockSend }) }),
}))

describe('Sessions API', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    mockSend.mockImplementation(async function* () {
      yield { type: 'text', content: 'refined intent response' }
      yield { type: 'done' }
    })

    const { buildServer } = await import('../../src/server.js')
    app = await buildServer({
      port: 0,
      mode: 'local',
      auth: 'none',
      claudeMode: 'cli',
      claudeModel: 'claude-sonnet-4-6',
      redisUrl: 'redis://localhost:6379',
    })
    await app.ready()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockImplementation(async function* () {
      yield { type: 'text', content: 'refined intent response' }
      yield { type: 'done' }
    })
  })

  afterAll(async () => { await app.close() })

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
  })

  it('POST /sessions creates session and returns id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { userId: 'user-1' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toHaveProperty('sessionId')
    expect(typeof body.sessionId).toBe('string')
    expect(mockPublishSessionGateway).toHaveBeenCalledOnce()
    expect(mockPublishSessionGateway).toHaveBeenCalledWith(body.sessionId)
  })

  it('GET /sessions/:id/messages returns empty array for new session', async () => {
    const create = await app.inject({
      method: 'POST', url: '/sessions', payload: { userId: 'u1' }
    })
    const { sessionId } = create.json()
    const res = await app.inject({ method: 'GET', url: `/sessions/${sessionId}/messages` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('GET /sessions/:id/messages returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'GET', url: '/sessions/00000000-0000-0000-0000-000000000000/messages' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /sessions/:id/messages returns 400 for non-UUID session id', async () => {
    const res = await app.inject({ method: 'GET', url: '/sessions/not-a-valid-uuid/messages' })
    expect(res.statusCode).toBe(400)
  })

  it('POST /sessions/:id/messages returns 400 for non-UUID session id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions/not-a-valid-uuid/messages',
      payload: { content: 'test' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /sessions starts a StreamConsumer for the session', async () => {
    mockStart.mockClear()
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { userId: 'user-consumer' },
    })
    expect(res.statusCode).toBe(201)
    const { sessionId } = res.json()
    expect(mockStart).toHaveBeenCalledOnce()
    expect(mockStart).toHaveBeenCalledWith(sessionId, expect.any(Function))
  })

  it('POST /sessions/:id/messages publishes task_request to Redis stream after Claude responds', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { userId: 'test-user' },
    })
    expect(createRes.statusCode).toBe(201)
    const { sessionId } = createRes.json()

    const msgRes = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/messages`,
      payload: { content: 'build me a todo app' },
    })
    expect(msgRes.statusCode).toBe(202)
    const { messageId } = msgRes.json()
    expect(typeof messageId).toBe('string')

    await vi.waitFor(() => {
      expect(mockPublish).toHaveBeenCalledTimes(1)
    }, { timeout: 2000 })

    const publishCall = mockPublish.mock.calls[0][0]
    expect(publishCall.sessionId).toBe(sessionId)
    expect(publishCall.type).toBe('task_request')
    expect(publishCall.payload.intent).toBe('refined intent response')
    expect(publishCall.payload.priority).toBe('normal')
    expect(typeof publishCall.messageId).toBe('string')
    expect(typeof publishCall.timestamp).toBe('number')
    expect(Array.isArray(publishCall.payload.context.history)).toBe(true)
  })

  it('POST /sessions/:id/messages returns 400 for missing/empty/non-string content', async () => {
    const { sessionId } = (await app.inject({ method: 'POST', url: '/sessions', payload: { userId: 'u' } })).json()
    for (const payload of [{}, { content: '' }, { content: 123 }, { content: null }]) {
      const res = await app.inject({ method: 'POST', url: `/sessions/${sessionId}/messages`, payload })
      expect(res.statusCode).toBe(400)
    }
  })

  it('POST /sessions/:id/messages returns 400 for unknown mode/gateMode', async () => {
    const { sessionId } = (await app.inject({ method: 'POST', url: '/sessions', payload: { userId: 'u' } })).json()
    const badMode = await app.inject({ method: 'POST', url: `/sessions/${sessionId}/messages`, payload: { content: 'hi', mode: 'nope' } })
    expect(badMode.statusCode).toBe(400)
    const badGate = await app.inject({ method: 'POST', url: `/sessions/${sessionId}/messages`, payload: { content: 'hi', gateMode: 'yolo' } })
    expect(badGate.statusCode).toBe(400)
  })
})
