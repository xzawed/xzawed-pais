import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Pool } from 'pg'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../sessions/session.store.js'
import type { ClaudeRunner } from '../claude/runner.interface.js'
import type { ManagerClient } from '../manager/manager.client.js'
import type { StreamProducer } from '../streams/producer.js'
import type { Message, ManagerToOrchestratorMessage } from '@xzawed/shared'
import { StreamConsumer } from '../streams/consumer.js'
import Anthropic from '@anthropic-ai/sdk'
import { structureIntent } from '../claude/intent-structurer.js'
import { TaskStore } from '../tasks/task.store.js'
import { MessageRepo } from '../sessions/message.repo.js'
import { assertProjectOwner } from '../auth/ownership.js'

const messageStore = new Map<string, Message[]>()
const claudeSessionIds = new Map<string, string>()
const taskStore = new TaskStore()

interface SessionsRoutesConfig {
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
  authHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  pool?: Pool
  userAuthHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
}

function handleConsumerMessage(
  msg: ManagerToOrchestratorMessage,
  sessionId: string,
  socket: WebSocket,
  consumers: Map<string, StreamConsumer>
): void {
  const activeTask = taskStore
    .findBySessionId(sessionId)
    .findLast(t => t.status === 'pending' || t.status === 'running')

  switch (msg.type) {
    case 'status_update':
      if (activeTask) taskStore.update(activeTask.id, 'running')
      socket.send(JSON.stringify({
        type: 'agent_status',
        agentId: msg.payload.agentId,
        content: msg.payload.content,
      }))
      break
    case 'task_complete':
      if (activeTask) taskStore.update(activeTask.id, 'completed', msg.payload.content)
      socket.send(JSON.stringify({
        type: 'agent_done',
        agentId: msg.payload.agentId,
        content: msg.payload.content,
      }))
      consumers.get(sessionId)?.stop()
      consumers.delete(sessionId)
      break
    case 'error':
      if (activeTask) taskStore.update(activeTask.id, 'failed', msg.payload.content)
      socket.send(JSON.stringify({
        type: 'agent_error',
        agentId: msg.payload.agentId,
        content: msg.payload.content,
      }))
      consumers.get(sessionId)?.stop()
      consumers.delete(sessionId)
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
}

export async function sessionsRoutes(
  app: FastifyInstance,
  config: SessionsRoutesConfig
): Promise<void> {
  const {
    store, runner, wsSessions, manager, redisUrl, producer,
    sessionConsumers, sessionCleanup, anthropicClient, claudeModel,
    authHook, pool, userAuthHook,
  } = config

  const msgRepo = pool ? new MessageRepo(pool) : undefined
  const effectiveAuthHook = userAuthHook ?? authHook
  const routeOpts = effectiveAuthHook ? { preHandler: effectiveAuthHook } : {}

  app.post<{ Body: { userId?: string; projectId?: string } }>('/sessions', routeOpts, async (req, reply) => {
    let userId: string
    let projectId: string | null = null

    if (userAuthHook) {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      if (!req.body.projectId) return reply.status(400).send({ error: 'projectId is required' })
      const project = await assertProjectOwner(req.authUser.sub, req.body.projectId, pool!, reply)
      if (!project) return
      userId = req.authUser.sub
      projectId = project.id
    } else {
      userId = req.body.userId ?? 'anonymous'
    }

    const session = await store.create(userId, projectId, 'cli')
    claudeSessionIds.set(session.id, '')

    if (!msgRepo) messageStore.set(session.id, [])

    sessionCleanup.set(session.id, () => {
      claudeSessionIds.delete(session.id)
      taskStore.deleteBySessionId(session.id)
      messageStore.delete(session.id)
      void store.delete(session.id).catch(() => undefined)
    })

    void manager.startSession(session.id).catch((err: unknown) => {
      req.log.warn({ err, sessionId: session.id }, 'Failed to start Manager session')
    })

    const consumer = new StreamConsumer(redisUrl)
    sessionConsumers.set(session.id, consumer)
    void consumer.start(session.id, async (msg) => {
      const socket = wsSessions.get(session.id)
      if (!socket) return
      handleConsumerMessage(msg, session.id, socket, sessionConsumers)
    }).catch((err: unknown) => {
      req.log.warn({ err, sessionId: session.id }, 'StreamConsumer error')
    })

    return reply.status(201).send({ sessionId: session.id })
  })

  app.get<{ Params: { id: string } }>('/sessions/:id/messages', routeOpts, async (req, reply) => {
    const session = await store.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    if (req.authUser && session.userId !== req.authUser.sub) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    if (msgRepo) return reply.send(await msgRepo.findBySession(req.params.id))
    return messageStore.get(req.params.id) ?? []
  })

  app.post<{ Params: { id: string }; Body: { content: string } }>(
    '/sessions/:id/messages',
    routeOpts,
    async (req, reply) => {
      const session = await store.findById(req.params.id)
      if (!session) return reply.status(404).send({ error: 'Session not found' })
      if (req.authUser && session.userId !== req.authUser.sub) {
        return reply.status(404).send({ error: 'Session not found' })
      }

      const userMsgId = crypto.randomUUID()
      let snapshot: Message[]

      if (msgRepo) {
        await msgRepo.create(req.params.id, 'user', req.body.content)
        snapshot = await msgRepo.findBySession(req.params.id)
      } else {
        const msg: Message = {
          id: userMsgId,
          sessionId: req.params.id,
          role: 'user',
          content: req.body.content,
          timestamp: Date.now(),
        }
        const history = messageStore.get(req.params.id) ?? []
        history.push(msg)
        snapshot = [...history]
      }

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
              await store.updateClaudeSessionId(req.params.id, chunk.content)
            } else if (chunk.type === 'error') {
              socket?.send(JSON.stringify({ type: 'error', content: chunk.content }))
              return
            } else if (chunk.type === 'done') {
              break
            }
          }

          if (msgRepo) {
            await msgRepo.create(req.params.id, 'assistant', fullContent)
          } else {
            const history = messageStore.get(req.params.id) ?? []
            history.push({
              id: assistantMsgId,
              sessionId: req.params.id,
              role: 'assistant',
              content: fullContent,
              timestamp: Date.now(),
            })
          }

          const intent = (anthropicClient && claudeModel)
            ? await structureIntent(fullContent, anthropicClient, claudeModel)
            : fullContent

          taskStore.create(req.params.id, intent)

          const userContext = session.projectId
            ? {
                userId: session.userId,
                projectId: session.projectId,
                workspaceRoot: `/workspace/${session.userId}/${session.projectId}`,
              }
            : undefined

          try {
            await producer.publish({
              sessionId: req.params.id,
              messageId: crypto.randomUUID(),
              timestamp: Date.now(),
              type: 'task_request',
              payload: {
                intent,
                context: { history: snapshot.map((m) => ({ role: m.role, content: m.content })) },
                priority: 'normal',
                ...(userContext ? { userContext } : {}),
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
      })().catch((err: unknown) => {
        app.log.error({ err, sessionId: req.params.id }, 'Unhandled error in message processing')
      })

      return reply.status(202).send({ messageId: userMsgId, status: 'accepted' })
    }
  )

  app.get<{ Params: { id: string } }>('/sessions/:id/tasks', routeOpts, async (req, reply) => {
    const session = await store.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    if (req.authUser && session.userId !== req.authUser.sub) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    return { tasks: taskStore.findBySessionId(req.params.id) }
  })
}
