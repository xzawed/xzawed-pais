import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { sessionsRoute } from '../../src/api/sessions.route.js'
import { SessionStore } from '../../src/sessions/session.store.js'
import type { OrchestratorToManagerMessage } from '../../src/types/streams.js'

vi.mock('../../src/workspace.js', () => ({
  ensureWorkspace: vi.fn().mockResolvedValue(undefined),
}))

type ConsumerCallback = (msg: OrchestratorToManagerMessage) => Promise<void>

let capturedCallback: ConsumerCallback | null = null
const mockStop = vi.fn()

vi.mock('../../src/streams/consumer.js', () => ({
  StreamConsumer: class {
    stop = mockStop
    ensureGroup = vi.fn().mockResolvedValue(undefined)
    start(_sessionId: string, cb: ConsumerCallback) {
      capturedCallback = cb
      return Promise.resolve()
    }
  },
}))

const SESSION_ID = '00000000-0000-0000-0000-000000000099'

function makeMsg(type: 'task_request' | 'info_response' | 'abort', extra: Record<string, unknown> = {}): OrchestratorToManagerMessage {
  const base = { sessionId: SESSION_ID, messageId: 'msg-1', timestamp: Date.now() }
  if (type === 'task_request') {
    return { ...base, type, payload: { intent: 'do something', context: {}, priority: 'normal', ...extra } }
  }
  if (type === 'info_response') {
    return { ...base, type, payload: { answer: 'yes', ...(extra as Record<string, never>) } }
  }
  return { ...base, type: 'abort', payload: {} }
}

async function buildApp(mockRun = vi.fn().mockResolvedValue('done'), mockPublish = vi.fn().mockResolvedValue('1-0')) {
  capturedCallback = null
  mockStop.mockClear()
  const sessionStore = new SessionStore()
  const app = Fastify()
  await app.register(sessionsRoute, {
    redisUrl: 'redis://localhost:6379',
    runner: { run: mockRun } as never,
    producer: { publish: mockPublish } as never,
    sessionStore,
  })
  // Start a session so consumer callback is captured
  await app.inject({ method: 'POST', url: `/api/sessions/${SESSION_ID}/start` })
  return { app, sessionStore, mockRun, mockPublish }
}

describe('sessions.route callback', () => {
  beforeEach(() => {
    capturedCallback = null
    mockStop.mockClear()
  })

  it('task_request — runner 성공 시 task_complete 발행', async () => {
    const { mockPublish } = await buildApp()
    await capturedCallback!(makeMsg('task_request'))
    // Allow inner void IIFE to settle
    await new Promise(r => setTimeout(r, 10))
    const calls = mockPublish.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type)
    expect(calls).toContain('task_complete')
    expect(mockStop).toHaveBeenCalled()
  })

  it('task_request + userContext — ensureWorkspace 호출 후 runner 실행', async () => {
    const { ensureWorkspace } = await import('../../src/workspace.js')
    const { mockRun } = await buildApp()
    const userContext = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace' }
    await capturedCallback!(makeMsg('task_request', { userContext }))
    await new Promise(r => setTimeout(r, 10))
    expect(ensureWorkspace).toHaveBeenCalledWith(userContext)
    expect(mockRun).toHaveBeenCalled()
  })

  it('task_request — runner 실패 시 error 발행', async () => {
    const failRunner = vi.fn().mockRejectedValue(new Error('run failed'))
    const { mockPublish } = await buildApp(failRunner)
    await capturedCallback!(makeMsg('task_request'))
    await new Promise(r => setTimeout(r, 10))
    const calls = mockPublish.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type)
    expect(calls).toContain('error')
    const errCall = mockPublish.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'error')
    expect((errCall![0] as { payload: { content: string } }).payload.content).toBe('run failed')
  })

  it('task_request — 비Error 예외 시 String()으로 변환하여 error 발행', async () => {
    const failRunner = vi.fn().mockRejectedValue('string error')
    const { mockPublish } = await buildApp(failRunner)
    await capturedCallback!(makeMsg('task_request'))
    await new Promise(r => setTimeout(r, 10))
    const errCall = mockPublish.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'error')
    expect((errCall![0] as { payload: { content: string } }).payload.content).toBe('string error')
  })

  it('info_response — sessionStore.resolveInfo 호출', async () => {
    const { sessionStore } = await buildApp()
    const spy = vi.spyOn(sessionStore, 'resolveInfo')
    await capturedCallback!(makeMsg('info_response'))
    expect(spy).toHaveBeenCalledWith(SESSION_ID, 'yes')
  })

  it('abort — sessionStore.abort + consumer.stop 호출', async () => {
    const { sessionStore } = await buildApp()
    const spy = vi.spyOn(sessionStore, 'abort')
    await capturedCallback!(makeMsg('abort'))
    expect(spy).toHaveBeenCalledWith(SESSION_ID)
    expect(mockStop).toHaveBeenCalled()
  })
})
