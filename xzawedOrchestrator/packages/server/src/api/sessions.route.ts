import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../sessions/session.store.js'
import type { ClaudeRunner } from '../claude/runner.interface.js'
import type { ManagerClient } from '../manager/manager.client.js'
import type { StreamProducer } from '../streams/producer.js'
import type { Message } from '@xzawed/shared'
import { StreamConsumer } from '../streams/consumer.js'
import Anthropic from '@anthropic-ai/sdk'
import { structureIntent } from '../claude/intent-structurer.js'

const messageStore = new Map<string, Message[]>()
const claudeSessionIds = new Map<string, string>()

export async function sessionsRoutes(
  app: FastifyInstance,
  {
    store,
    runner,
    wsSessions,
    manager,
    redisUrl,
    producer,
    sessionConsumers,
    sessionCleanup,
    anthropicClient,
    claudeModel,
  }: {
    store: SessionStore
    runner: ClaudeRunner
    wsSessions: Map<string, WebSocket>
    manager: ManagerClient
    redisUrl: string
    producer: StreamProducer
    sessionConsumers: Map<string, StreamConsumer>
    sessionCleanup: Map<string, () => void>
    anthropicClient?: Anthropic
    claudeModel?: string
  }
): Promise<void> {
  app.post<{ Body: { userId: string } }>('/sessions', async (req, reply) => {
    const { userId } = req.body
    const session = store.create(userId ?? 'anonymous', 'cli')
    messageStore.set(session.id, [])
    claudeSessionIds.set(session.id, '')
    sessionCleanup.set(session.id, () => {
      messageStore.delete(session.id)
      claudeSessionIds.delete(session.id)
      store.delete(session.id)
    })

    // Notify Manager to start listening on the Redis stream for this session.
    // Fire-and-forget with best-effort: session creation must not fail if Manager is unavailable.
    void manager.startSession(session.id).catch((err: unknown) => {
      req.log.warn({ err, sessionId: session.id }, 'Failed to start Manager session')
    })

    // Start Manager response consumer for this session
    const consumer = new StreamConsumer(redisUrl)
    sessionConsumers.set(session.id, consumer)
    void consumer.start(session.id, async (msg) => {
      const socket = wsSessions.get(session.id)
      if (!socket) return

      switch (msg.type) {
        case 'status_update':
          socket.send(JSON.stringify({
            type: 'agent_status',
            agentId: msg.payload.agentId,
            content: msg.payload.content,
          }))
          break
        case 'task_complete':
          socket.send(JSON.stringify({
            type: 'agent_done',
            agentId: msg.payload.agentId,
            content: msg.payload.content,
          }))
          consumer.stop()
          sessionConsumers.delete(session.id)
          break
        case 'error':
          socket.send(JSON.stringify({
            type: 'agent_error',
            agentId: msg.payload.agentId,
            content: msg.payload.content,
          }))
          consumer.stop()
          sessionConsumers.delete(session.id)
          break
        case 'info_request':
          socket.send(JSON.stringify({
            type: 'agent_info_request',
            agentId: msg.payload.agentId,
            content: msg.payload.content,
            ...(msg.payload.uiSpec !== undefined ? { uiSpec: msg.payload.uiSpec } : {}),
          }))
          break
      }
    }).catch((err: unknown) => {
      req.log.warn({ err, sessionId: session.id }, 'StreamConsumer error')
    })

    return reply.status(201).send({ sessionId: session.id })
  })

  app.get<{ Params: { id: string } }>('/sessions/:id/messages', async (req, reply) => {
    const session = store.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    return messageStore.get(req.params.id) ?? []
  })

  app.post<{ Params: { id: string }; Body: { content: string } }>(
    '/sessions/:id/messages',
    async (req, reply) => {
      const session = store.findById(req.params.id)
      if (!session) return reply.status(404).send({ error: 'Session not found' })

      const msg: Message = {
        id: crypto.randomUUID(),
        sessionId: req.params.id,
        role: 'user',
        content: req.body.content,
        timestamp: Date.now(),
      }

      const history = messageStore.get(req.params.id) ?? []
      history.push(msg)
      // Snapshot taken synchronously before any event loop yield — prevents concurrent-request contamination
      const snapshot = [...history]

      // Fire-and-forget: stream Claude response over WebSocket
      void (async () => {
        const socket = wsSessions.get(req.params.id)
        const assistantMsgId = crypto.randomUUID()

        try {
          const storedClaudeSessionId = claudeSessionIds.get(req.params.id)
          const runOptions = {
            ...(storedClaudeSessionId ? { claudeSessionId: storedClaudeSessionId } : {}),
          }
          let fullContent = ''
          for await (const chunk of runner.send(snapshot, runOptions)) {
            if (chunk.type === 'text') {
              fullContent += chunk.content
              socket?.send(
                JSON.stringify({ type: 'chunk', messageId: assistantMsgId, content: chunk.content })
              )
            } else if (chunk.type === 'claude_session') {
              claudeSessionIds.set(req.params.id, chunk.content)
            } else if (chunk.type === 'error') {
              socket?.send(JSON.stringify({ type: 'error', content: chunk.content }))
              return
            } else if (chunk.type === 'done') {
              break
            }
          }

          // Store finalized assistant message
          const assistantMsg: Message = {
            id: assistantMsgId,
            sessionId: req.params.id,
            role: 'assistant',
            content: fullContent,
            timestamp: Date.now(),
          }
          history.push(assistantMsg)

          // Publish task_request to Redis stream (best-effort: don't block done if Manager unavailable)
          const intent = (anthropicClient && claudeModel)
            ? await structureIntent(fullContent, anthropicClient, claudeModel)
            : fullContent

          try {
            const msgId = crypto.randomUUID()
            await producer.publish({
              sessionId: req.params.id,
              messageId: msgId,
              timestamp: Date.now(),
              type: 'task_request',
              payload: {
                intent,
                context: { history: snapshot.map((m) => ({ role: m.role, content: m.content })) },
                priority: 'normal',
              },
            })
            socket?.send(JSON.stringify({ type: 'status', content: '전달 중...' }))
          } catch (publishErr: unknown) {
            app.log.warn({ err: publishErr }, 'Redis publish failed — Manager unavailable, skipping forwarding')
          }

          socket?.send(JSON.stringify({ type: 'done', messageId: assistantMsgId }))
        } catch (err) {
          const content = err instanceof Error ? err.message : String(err)
          socket?.send(JSON.stringify({ type: 'error', content }))
        }
      })()

      return reply.status(202).send({ messageId: msg.id, status: 'accepted' })
    }
  )

  app.get<{ Params: { id: string } }>('/sessions/:id/tasks', async (req, reply) => {
    const session = store.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    return { tasks: [] }
  })
}
