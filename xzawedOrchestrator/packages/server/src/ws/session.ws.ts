import type { FastifyInstance } from 'fastify'
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
  }: { store: SessionStore; wsSessions: Map<string, WebSocket>; sessionConsumers: Map<string, StreamConsumer>; sessionCleanup: Map<string, () => void> }
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/ws/sessions/:id',
    { websocket: true },
    (socket, req) => {
      const sessionId = req.params.id
      const session = store.findById(sessionId)

      if (!session) {
        socket.send(JSON.stringify({ type: 'error', content: 'Session not found' }))
        socket.close()
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

      socket.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString())
          socket.send(JSON.stringify({ type: 'ack', messageId: msg.id }))
        } catch {
          socket.send(JSON.stringify({ type: 'error', content: 'Invalid JSON' }))
        }
      })

      socket.send(JSON.stringify({ type: 'connected', sessionId }))
    }
  )
}
