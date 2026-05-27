import { z } from 'zod'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { StreamConsumer } from '../streams/consumer.js'
import type { StreamProducer } from '../streams/producer.js'
import type { ClaudeRunner, RunnerOptions } from '../claude/runner.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { OrchestratorToManagerMessage } from '../types/streams.js'
import { ensureWorkspace } from '../workspace.js'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

export interface SessionsRouteOptions {
  redisUrl: string
  runner: ClaudeRunner
  producer: StreamProducer
  sessionStore: SessionStore
  registry?: ToolRegistry
  activeConsumers?: Map<string, StreamConsumer>
  authHook?: RouteHook
}

export function makeSessionStarter(
  opts: Pick<SessionsRouteOptions, 'redisUrl' | 'runner' | 'producer' | 'sessionStore'> & {
    activeConsumers: Map<string, StreamConsumer>
    registry?: ToolRegistry
    log: { error: (obj: unknown, msg: string) => void }
  },
) {
  return function startManagedSession(sessionId: string): void {
    if (opts.activeConsumers.has(sessionId)) return

    opts.sessionStore.create(sessionId)
    const consumer = new StreamConsumer(opts.redisUrl)
    opts.activeConsumers.set(sessionId, consumer)

    void consumer.start(sessionId, async (msg: OrchestratorToManagerMessage) => {
      if (msg.type === 'task_request') {
        void (async () => {
          try {
            const { userContext } = msg.payload
            if (userContext !== undefined) {
              await ensureWorkspace(userContext)
            }
            const sig = opts.sessionStore.getAbortSignal(sessionId)
            const result = await opts.runner.run({
              sessionId,
              intent: msg.payload.intent,
              context: msg.payload.context,
              producer: opts.producer,
              sessionStore: opts.sessionStore,
              ...(sig !== undefined && { signal: sig }),
              ...(userContext !== undefined && { userContext }),
            } satisfies RunnerOptions)

            await opts.producer.publish({
              sessionId,
              messageId: crypto.randomUUID(),
              timestamp: Date.now(),
              type: 'task_complete',
              payload: { agentId: 'manager', content: result },
            })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            // Do NOT publish an error for intentional aborts
            if (message === 'Session aborted') return
            await opts.producer.publish({
              sessionId,
              messageId: crypto.randomUUID(),
              timestamp: Date.now(),
              type: 'error',
              payload: {
                agentId: 'manager',
                content: message,
              },
            })
          } finally {
            consumer.stop()
            opts.sessionStore.delete(sessionId)
            opts.activeConsumers.delete(sessionId)
            opts.registry?.releaseAll(sessionId)
          }
        })().catch((err: unknown) => {
          opts.log.error({ err, sessionId }, 'Unexpected task runner error')
        })
      } else if (msg.type === 'info_response') {
        opts.sessionStore.resolveInfo(sessionId, msg.payload.answer)
      } else if (msg.type === 'abort') {
        opts.sessionStore.abort(sessionId)
        consumer.stop()
        opts.activeConsumers.delete(sessionId)
        opts.sessionStore.delete(sessionId)
      }
    }).catch((err: unknown) => {
      opts.log.error({ err, sessionId }, 'StreamConsumer error')
      opts.sessionStore.delete(sessionId)
      opts.activeConsumers.delete(sessionId)
    })
  }
}

export async function sessionsRoute(
  app: FastifyInstance,
  opts: SessionsRouteOptions,
): Promise<void> {
  const { redisUrl, runner, producer, sessionStore, registry } = opts
  const activeConsumers = opts.activeConsumers ?? new Map<string, StreamConsumer>()
  const preHandler = opts.authHook ? [opts.authHook] : []

  const startManagedSession = makeSessionStarter({
    redisUrl, runner, producer, sessionStore, activeConsumers,
    ...(registry !== undefined && { registry }),
    log: { error: (obj, msg) => app.log.error(obj, msg) },
  })

  app.post<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/start',
    { preHandler },
    async (req, reply) => {
      const uuidResult = z.string().uuid().safeParse(req.params.sessionId)
      if (!uuidResult.success) {
        return reply.status(400).send({ error: 'Invalid sessionId format' })
      }
      const { sessionId } = req.params

      if (activeConsumers.has(sessionId)) {
        return reply.status(409).send({ error: 'Session already active' })
      }

      startManagedSession(sessionId)
      return reply.status(202).send({ sessionId, status: 'started' })
    },
  )
}
