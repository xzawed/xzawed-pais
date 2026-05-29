import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../sessions/session.store.js'
import type { StreamConsumer } from '../streams/consumer.js'

export async function sessionWsRoutes(
  app: FastifyInstance,
  {
    store,
    wsSessions,
    sessionConsumers,
    sessionCleanup,
    authHook,
    userAuthHook,
  }: {
    store: SessionStore
    wsSessions: Map<string, WebSocket>
    sessionConsumers: Map<string, StreamConsumer>
    sessionCleanup: Map<string, () => void>
    authHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    userAuthHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
): Promise<void> {
  const effectiveAuthHook = userAuthHook ?? authHook

  app.get<{ Params: { id: string } }>(
    '/ws/sessions/:id',
    { websocket: true as const, ...(effectiveAuthHook ? { preHandler: effectiveAuthHook } : {}) },
    async (socket, req) => {
      const sessionId = req.params.id
      const session = await store.findById(sessionId)

      if (!session) {
        socket.send(JSON.stringify({ type: 'error', content: 'Session not found' }))
        socket.close()
        return
      }

      if (req.authUser && session.userId !== req.authUser.sub) {
        socket.send(JSON.stringify({ type: 'error', content: 'Forbidden' }))
        socket.close(1008)
        return
      }

      wsSessions.set(sessionId, socket)

      socket.on('close', () => {
        wsSessions.delete(sessionId)
        const consumer = sessionConsumers.get(sessionId)
        if (consumer) {
          consumer.stop()
          sessionConsumers.delete(sessionId)
        }
        const cleanup = sessionCleanup.get(sessionId)
        if (cleanup) {
          cleanup()
          sessionCleanup.delete(sessionId)
        }
      })

      socket.send(JSON.stringify({ type: 'connected', sessionId }))
    }
  )
}
