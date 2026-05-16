import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { SessionStore } from '../sessions/session.store.js'

export function createMcpServer(store: SessionStore): McpServer {
  const server = new McpServer({
    name: 'xzawed-orchestrator',
    version: '0.1.0',
  })

  server.tool(
    'create_session',
    'xzawedOrchestrator에 새 세션을 생성합니다',
    { userId: z.string().describe('사용자 ID') },
    async ({ userId }) => {
      const session = store.create(userId, 'cli')
      return {
        content: [{ type: 'text', text: JSON.stringify({ sessionId: session.id }) }]
      }
    }
  )

  server.tool(
    'get_session_status',
    '세션 상태를 조회합니다',
    { sessionId: z.string().describe('세션 ID') },
    async ({ sessionId }) => {
      const session = store.findById(sessionId)
      if (!session) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(session) }] }
    }
  )

  server.tool(
    'list_sessions',
    '사용자의 세션 목록을 조회합니다',
    { userId: z.string().describe('사용자 ID') },
    async ({ userId }) => {
      const sessions = store.findByUserId(userId)
      return { content: [{ type: 'text', text: JSON.stringify(sessions) }] }
    }
  )

  return server
}

export async function startMcpStdio(store: SessionStore): Promise<void> {
  const server = createMcpServer(store)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
