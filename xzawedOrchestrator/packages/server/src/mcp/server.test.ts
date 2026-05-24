import { describe, it, expect } from 'vitest'
import { createMcpServer } from './server.js'
import { InMemorySessionStore } from '../sessions/session.store.js'

type Handler = (args: Record<string, string>, extra: unknown) => Promise<{ content: { text: string }[] }>
type McpServerInternal = { _registeredTools: Record<string, { handler: Handler }> }

describe('createMcpServer', () => {
  it('서버 인스턴스를 생성한다', () => {
    const store = new InMemorySessionStore()
    const server = createMcpServer(store)
    expect(server).toBeDefined()
  })

  it('3개 툴이 등록된다', () => {
    const store = new InMemorySessionStore()
    const server = createMcpServer(store) as unknown as McpServerInternal
    const names = Object.keys(server._registeredTools)
    expect(names).toContain('create_session')
    expect(names).toContain('get_session_status')
    expect(names).toContain('list_sessions')
  })

  it('create_session 툴이 세션을 생성한다', async () => {
    const store = new InMemorySessionStore()
    const server = createMcpServer(store) as unknown as McpServerInternal
    const result = await server._registeredTools['create_session'].handler({ userId: 'u1' }, {})
    const payload = JSON.parse(result.content[0].text) as { sessionId: string }
    expect(typeof payload.sessionId).toBe('string')
  })

  it('get_session_status 툴이 존재하지 않는 세션에 에러를 반환한다', async () => {
    const store = new InMemorySessionStore()
    const server = createMcpServer(store) as unknown as McpServerInternal
    const result = await server._registeredTools['get_session_status'].handler({ sessionId: 'nonexistent' }, {})
    const payload = JSON.parse(result.content[0].text) as { error?: string }
    expect(payload.error).toBe('Session not found')
  })

  it('list_sessions 툴이 사용자 세션 목록을 반환한다', async () => {
    const store = new InMemorySessionStore()
    await store.create('u1', null, 'api')
    const server = createMcpServer(store) as unknown as McpServerInternal
    const result = await server._registeredTools['list_sessions'].handler({ userId: 'u1' }, {})
    const sessions = JSON.parse(result.content[0].text) as unknown[]
    expect(sessions).toHaveLength(1)
  })
})
