import { vi, describe, it, expect, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../streams/consumer.js')
vi.mock('../workspace.js', () => ({ ensureWorkspace: vi.fn().mockResolvedValue(undefined) }))

import { StreamConsumer } from '../streams/consumer.js'
import { sessionsRoute } from './sessions.route.js'
import { SessionStore } from '../sessions/session.store.js'
import type { OrchestratorToManagerMessage } from '../types/streams.js'

type MsgHandler = (msg: OrchestratorToManagerMessage) => Promise<void>

const SESSION_A = '550e8400-e29b-41d4-a716-446655440000'
const SESSION_B = '550e8400-e29b-41d4-a716-446655440001'

function makeTaskRequest(sessionId: string): OrchestratorToManagerMessage {
  return {
    sessionId,
    messageId: 'msg-1',
    timestamp: Date.now(),
    type: 'task_request',
    payload: { intent: 'test', context: {}, priority: 'normal' },
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('sessionsRoute — abort 처리', () => {
  it('"Session aborted" 에러 시 error 메시지를 발행하지 않는다', async () => {
    const capturedHandlers: MsgHandler[] = []
    vi.mocked(StreamConsumer).mockImplementation(() => ({
      start: vi.fn().mockImplementation(async (_sid: string, handler: MsgHandler) => {
        capturedHandlers.push(handler)
      }),
      stop: vi.fn(),
    }) as unknown as StreamConsumer)

    const mockRun = vi.fn().mockRejectedValue(new Error('Session aborted'))
    const mockPublish = vi.fn().mockResolvedValue(undefined)
    const sessionStore = new SessionStore()

    const app = Fastify({ logger: false })
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: mockRun } as never,
      producer: { publish: mockPublish } as never,
      sessionStore,
    })

    const res = await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_A}/start` })
    expect(res.statusCode).toBe(202)

    await capturedHandlers[0]!(makeTaskRequest(SESSION_A))
    await flushMicrotasks()

    const errorCalls = mockPublish.mock.calls.filter(([m]) => (m as { type: string }).type === 'error')
    expect(errorCalls).toHaveLength(0)

    await app.close()
  })

  it('"Session aborted" 외 에러는 error 타입 메시지를 발행한다', async () => {
    const capturedHandlers: MsgHandler[] = []
    vi.mocked(StreamConsumer).mockImplementation(() => ({
      start: vi.fn().mockImplementation(async (_sid: string, handler: MsgHandler) => {
        capturedHandlers.push(handler)
      }),
      stop: vi.fn(),
    }) as unknown as StreamConsumer)

    const mockRun = vi.fn().mockRejectedValue(new Error('Something went wrong'))
    const mockPublish = vi.fn().mockResolvedValue(undefined)
    const sessionStore = new SessionStore()

    const app = Fastify({ logger: false })
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: mockRun } as never,
      producer: { publish: mockPublish } as never,
      sessionStore,
    })

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_B}/start` })
    await capturedHandlers[0]!(makeTaskRequest(SESSION_B))
    await flushMicrotasks()

    const errorCalls = mockPublish.mock.calls.filter(([m]) => (m as { type: string }).type === 'error')
    expect(errorCalls).toHaveLength(1)
    expect((errorCalls[0]![0] as { payload: { content: string } }).payload.content).toBe('Something went wrong')

    await app.close()
  })
})
