import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { StreamConsumer } from '../streams/consumer.js'
import type { StreamProducer } from '../streams/producer.js'
import type { ClaudeRunner, RunnerOptions } from '../claude/runner.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { OrchestratorToManagerMessage } from '../types/streams.js'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

interface SessionsRouteOptions {
  redisUrl: string
  runner: ClaudeRunner
  producer: StreamProducer
  sessionStore: SessionStore
  activeConsumers?: Map<string, StreamConsumer>
  authHook?: RouteHook
}

export async function sessionsRoute(
  app: FastifyInstance,
  opts: SessionsRouteOptions,
): Promise<void> {
  const { redisUrl, runner, producer, sessionStore } = opts
  const activeConsumers = opts.activeConsumers ?? new Map<string, StreamConsumer>()
  const preHandler = opts.authHook ? [opts.authHook] : []

  app.post<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/start',
    { preHandler },
    async (req, reply) => {
      const { sessionId } = req.params

      if (activeConsumers.has(sessionId)) {
        return reply.status(409).send({ error: 'Session already active' })
      }

      const consumer = new StreamConsumer(redisUrl)
      activeConsumers.set(sessionId, consumer)
      sessionStore.create(sessionId)

      void consumer.start(sessionId, async (msg: OrchestratorToManagerMessage) => {
        if (msg.type === 'task_request') {
          void (async () => {
            try {
              const sig = sessionStore.getAbortSignal(sessionId)
              const result = await runner.run({
                sessionId,
                intent: msg.payload.intent,
                context: msg.payload.context,
                producer,
                sessionStore,
                ...(sig !== undefined && { signal: sig }),
              } satisfies RunnerOptions)

              await producer.publish({
                sessionId,
                messageId: crypto.randomUUID(),
                timestamp: Date.now(),
                type: 'task_complete',
                payload: { agentId: 'manager', content: result },
              })
            } catch (err) {
              await producer.publish({
                sessionId,
                messageId: crypto.randomUUID(),
                timestamp: Date.now(),
                type: 'error',
                payload: {
                  agentId: 'manager',
                  content: err instanceof Error ? err.message : String(err),
                },
              })
            } finally {
              consumer.stop()
              sessionStore.delete(sessionId)
              activeConsumers.delete(sessionId)
            }
          })()
        } else if (msg.type === 'info_response') {
          sessionStore.resolveInfo(sessionId, msg.payload.answer)
        } else if (msg.type === 'abort') {
          sessionStore.abort(sessionId)
          consumer.stop()
          activeConsumers.delete(sessionId)
        }
      })

      return reply.status(202).send({ sessionId, status: 'started' })
    },
  )
}
