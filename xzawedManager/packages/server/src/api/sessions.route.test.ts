import { vi, describe, it, expect, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../streams/consumer.js')
vi.mock('../workspace.js', () => ({ ensureWorkspace: vi.fn().mockResolvedValue(undefined) }))

import { StreamConsumer } from '../streams/consumer.js'
import { ensureWorkspace } from '../workspace.js'
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
    vi.mocked(StreamConsumer).mockImplementation(function () { return ({
      start: vi.fn().mockImplementation(async (_sid: string, handler: MsgHandler) => {
        capturedHandlers.push(handler)
      }),
      stop: vi.fn(),
    }) as unknown as StreamConsumer })

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
    vi.mocked(StreamConsumer).mockImplementation(function () { return ({
      start: vi.fn().mockImplementation(async (_sid: string, handler: MsgHandler) => {
        capturedHandlers.push(handler)
      }),
      stop: vi.fn(),
    }) as unknown as StreamConsumer })

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

describe('sessionsRoute — decompose_request 배선 (P4a-2)', () => {
  it('payload.userContext가 ensureWorkspace를 거쳐 decomposition.emitted payload까지 도달한다', async () => {
    const capturedHandlers: MsgHandler[] = []
    vi.mocked(StreamConsumer).mockImplementation(function () { return ({
      start: vi.fn().mockImplementation(async (_sid: string, handler: MsgHandler) => {
        capturedHandlers.push(handler)
      }),
      stop: vi.fn(),
    }) as unknown as StreamConsumer })

    // LLM 실패 → fallback 단일 WP 경로(P4a-2: fallback도 userContext 보존)
    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const decompose = {
      claude: { messages: { create: vi.fn().mockRejectedValue(new Error('llm down')) } },
      model: 'm', publish: emitPublish, now: () => 1,
    }
    const mockPublish = vi.fn().mockResolvedValue(undefined)
    const sessionStore = new SessionStore()

    const app = Fastify({ logger: false })
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: vi.fn() } as never,
      producer: { publish: mockPublish } as never,
      sessionStore,
      decompose: decompose as never,
    })

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_A}/start` })
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/p1' }
    await capturedHandlers[0]!({
      sessionId: SESSION_A, messageId: 'msg-d', timestamp: Date.now(),
      type: 'decompose_request', payload: { intent: 'build it', userContext: uc },
    })
    // fire-and-forget 체인(ensureWs→분해 fallback→emit)이 microtask 수 회를 넘으므로 폴링 대기
    await vi.waitFor(() => expect(emitPublish).toHaveBeenCalledTimes(1))

    expect(vi.mocked(ensureWorkspace)).toHaveBeenCalledWith(uc)
    const emitted = emitPublish.mock.calls[0]![1] as { payload: { userContext?: unknown } }
    expect(emitted.payload.userContext).toEqual(uc)

    await app.close()
  })
})
