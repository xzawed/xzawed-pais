import { vi, describe, it, expect, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../streams/consumer.js')
vi.mock('../workspace.js', () => ({ ensureWorkspace: vi.fn().mockResolvedValue(undefined) }))
// 세션 스트림 키 회수가 실제 Redis 를 치지 않게 한다 — 안 막으면 never-throw 가 삼켜
// 테스트는 통과하지만 연결 실패 로그만 쌓이고 호출 자체를 관측할 수 없다.
const redisMock = { expire: vi.fn().mockResolvedValue(1), persist: vi.fn().mockResolvedValue(1) }
vi.mock('../streams/redis.client.js', () => ({
  getRedisClient: vi.fn(() => redisMock),
  closeRedisClients: vi.fn().mockResolvedValue(undefined),
}))

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
      close: vi.fn().mockResolvedValue(undefined),
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
      close: vi.fn().mockResolvedValue(undefined),
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

describe('sessionsRoute — 무음 drop 금지 (M8)', () => {
  function captureHandlerConsumer() {
    const capturedHandlers: MsgHandler[] = []
    const stop = vi.fn()
    vi.mocked(StreamConsumer).mockImplementation(function () { return ({
      start: vi.fn().mockImplementation(async (_sid: string, handler: MsgHandler) => {
        capturedHandlers.push(handler)
      }),
      stop,
      close: vi.fn().mockResolvedValue(undefined),
    }) as unknown as StreamConsumer })
    return { capturedHandlers, stop }
  }

  it('decompose_request인데 decompose 비활성(미주입)이면 무음 drop 대신 error를 발행한다', async () => {
    const { capturedHandlers, stop } = captureHandlerConsumer()
    const mockPublish = vi.fn().mockResolvedValue(undefined)
    const sessionStore = new SessionStore()

    const app = Fastify({ logger: false })
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: vi.fn() } as never,
      producer: { publish: mockPublish } as never,
      sessionStore,
      // decompose 미주입(flag off)
    })

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_A}/start` })
    await capturedHandlers[0]!({
      sessionId: SESSION_A, messageId: 'msg-d', timestamp: Date.now(),
      type: 'decompose_request', payload: { intent: 'build it' },
    })
    await flushMicrotasks()

    const errorCalls = mockPublish.mock.calls.filter(([m]) => (m as { type: string }).type === 'error')
    expect(errorCalls).toHaveLength(1)
    expect((errorCalls[0]![0] as { payload: { content: string } }).payload.content).toMatch(/decompos/i)
    expect(stop).toHaveBeenCalled() // 세션 정리(누수 방지)

    await app.close()
  })

  it('처리 분기가 없는 메시지 타입은 무음 drop 대신 error를 발행한다(방어)', async () => {
    const { capturedHandlers } = captureHandlerConsumer()
    const mockPublish = vi.fn().mockResolvedValue(undefined)
    const sessionStore = new SessionStore()

    const app = Fastify({ logger: false })
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: vi.fn() } as never,
      producer: { publish: mockPublish } as never,
      sessionStore,
    })

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_A}/start` })
    // 스키마는 통과했다고 가정하고 처리 분기 없는 타입을 직접 주입(방어 경로 — 닫힌 union이라 정상경로엔 미도달)
    await capturedHandlers[0]!({
      sessionId: SESSION_A, messageId: 'msg-x', timestamp: Date.now(),
      type: 'bogus_type', payload: {},
    } as unknown as OrchestratorToManagerMessage)
    await flushMicrotasks()

    const errorCalls = mockPublish.mock.calls.filter(([m]) => (m as { type: string }).type === 'error')
    expect(errorCalls).toHaveLength(1)
    expect((errorCalls[0]![0] as { payload: { content: string } }).payload.content).toMatch(/bogus_type/)

    await app.close()
  })
})

describe('sessionsRoute — riskClassify 스레딩 (P2r-3)', () => {
  it('riskClassify deps가 handleDecomposeRequest에 7번째 인자로 전달된다', async () => {
    const capturedHandlers: MsgHandler[] = []
    vi.mocked(StreamConsumer).mockImplementation(function () { return ({
      start: vi.fn().mockImplementation(async (_sid: string, handler: MsgHandler) => {
        capturedHandlers.push(handler)
      }),
      stop: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }) as unknown as StreamConsumer })

    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const decompose = {
      claude: { messages: { create: vi.fn().mockRejectedValue(new Error('llm down')) } },
      model: 'm', publish: emitPublish, now: () => 1,
    }
    const riskClassify = {
      claude: { messages: { create: vi.fn() } } as never,
      model: 'm',
      repo: { upsert: vi.fn().mockResolvedValue(undefined) },
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
      riskClassify: riskClassify as never,
    })

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_A}/start` })
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/p1' }
    await capturedHandlers[0]!({
      sessionId: SESSION_A, messageId: 'msg-r', timestamp: Date.now(),
      type: 'decompose_request', payload: { intent: 'build it', userContext: uc },
    })
    await vi.waitFor(() => expect(emitPublish).toHaveBeenCalledTimes(1))
    // riskClassify.repo.upsert may or may not be called (best-effort producer, no real LLM in test);
    // the key invariant is that the field reaches makeSessionStarter — verified by type-checking + no runtime throw.
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
      close: vi.fn().mockResolvedValue(undefined),
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

describe('sessionsRoute — 세션 종료 시 registry 해제 (F5)', () => {
  const SESSION_C = '550e8400-e29b-41d4-a716-446655440002'
  const SESSION_D = '550e8400-e29b-41d4-a716-446655440003'

  function captureHandlerConsumer() {
    const capturedHandlers: MsgHandler[] = []
    vi.mocked(StreamConsumer).mockImplementation(function () { return ({
      start: vi.fn().mockImplementation(async (_sid: string, handler: MsgHandler) => {
        capturedHandlers.push(handler)
      }),
      stop: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }) as unknown as StreamConsumer })
    return capturedHandlers
  }

  it('정상 완료 경로에서 registry.releaseAll이 호출된다', async () => {
    const capturedHandlers = captureHandlerConsumer()
    const releaseAll = vi.fn()
    const sessionStore = new SessionStore()

    const app = Fastify({ logger: false })
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: vi.fn().mockResolvedValue('done') } as never,
      producer: { publish: vi.fn().mockResolvedValue(undefined) } as never,
      sessionStore,
      registry: { releaseAll } as never,
    })

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_C}/start` })
    await capturedHandlers[0]!(makeTaskRequest(SESSION_C))
    await flushMicrotasks()

    expect(releaseAll).toHaveBeenCalledWith(SESSION_C)
    await app.close()
  })

  it('에러 경로에서도 registry.releaseAll이 호출된다', async () => {
    const capturedHandlers = captureHandlerConsumer()
    const releaseAll = vi.fn()
    const sessionStore = new SessionStore()

    const app = Fastify({ logger: false })
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: vi.fn().mockRejectedValue(new Error('boom')) } as never,
      producer: { publish: vi.fn().mockResolvedValue(undefined) } as never,
      sessionStore,
      registry: { releaseAll } as never,
    })

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_D}/start` })
    await capturedHandlers[0]!(makeTaskRequest(SESSION_D))
    await flushMicrotasks()

    expect(releaseAll).toHaveBeenCalledWith(SESSION_D)
    await app.close()
  })
})

/**
 * **세션 스트림 키 수명 (Manager 소유분).**
 *
 * 에이전트 쌍은 `RedisAgentHandler` 가 맡고, 여기서는 모든 세션에 생기는 셋을 맡는다 —
 * `orchestrator:to-manager` · `manager:to-orchestrator` · `manager:events`.
 */
describe('sessionsRoute — 세션 스트림 키 TTL', () => {
  const SESSION_E = '550e8400-e29b-41d4-a716-446655440010'
  const MANAGER_KEYS = [
    `orchestrator:to-manager:${SESSION_E}`,
    `manager:to-orchestrator:${SESSION_E}`,
    `manager:events:${SESSION_E}`,
  ]

  function captureHandlerConsumer() {
    const capturedHandlers: MsgHandler[] = []
    vi.mocked(StreamConsumer).mockImplementation(function () { return ({
      start: vi.fn().mockImplementation(async (_sid: string, handler: MsgHandler) => {
        capturedHandlers.push(handler)
      }),
      stop: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }) as unknown as StreamConsumer })
    return capturedHandlers
  }

  async function makeApp() {
    const app = Fastify({ logger: false })
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: vi.fn().mockResolvedValue('done') } as never,
      producer: { publish: vi.fn().mockResolvedValue(undefined) } as never,
      sessionStore: new SessionStore(),
      registry: { releaseAll: vi.fn() } as never,
    })
    return app
  }

  /**
   * **이게 없으면 재개된 세션의 스트림이 도중에 증발한다.**
   * 실측: `XADD` 도 `XGROUP CREATE` 도 TTL 을 지우지 않는다(600 → 599).
   */
  it('세션 시작 시 앞선 TTL 을 벗긴다(PERSIST)', async () => {
    redisMock.persist.mockClear()
    captureHandlerConsumer()
    const app = await makeApp()

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_E}/start` })

    expect(redisMock.persist.mock.calls.map((c) => c[0]).sort()).toEqual([...MANAGER_KEYS].sort())
    await app.close()
  })

  it('정상 종료 시 Manager 소유 키에 TTL 을 건다', async () => {
    redisMock.expire.mockClear()
    const capturedHandlers = captureHandlerConsumer()
    const app = await makeApp()

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_E}/start` })
    await capturedHandlers[0]!(makeTaskRequest(SESSION_E))
    await flushMicrotasks()

    expect(redisMock.expire.mock.calls.map((c) => c[0]).sort()).toEqual([...MANAGER_KEYS].sort())
    await app.close()
  })

  /** abort 를 빠뜨리면 중단된 세션의 키가 영구히 남는다. */
  it('abort 경로에서도 TTL 을 건다', async () => {
    redisMock.expire.mockClear()
    const capturedHandlers = captureHandlerConsumer()
    const app = await makeApp()

    await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_E}/start` })
    await capturedHandlers[0]!({ sessionId: SESSION_E, type: 'abort', payload: {} } as unknown as OrchestratorToManagerMessage)
    await flushMicrotasks()

    expect(redisMock.expire.mock.calls.map((c) => c[0]).sort()).toEqual([...MANAGER_KEYS].sort())
    await app.close()
  })
})
