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
    cleanupGraceMs,
    authHook,
    userAuthHook,
  }: {
    store: SessionStore
    wsSessions: Map<string, WebSocket>
    sessionConsumers: Map<string, StreamConsumer>
    sessionCleanup: Map<string, () => void>
    cleanupGraceMs: number
    authHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    userAuthHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
): Promise<void> {
  const effectiveAuthHook = userAuthHook ?? authHook

  // Pending deferred-teardown timers, keyed by sessionId. A WS disconnect schedules
  // teardown after the grace window instead of tearing down immediately, so a client that
  // reconnects within the window (e.g. React StrictMode remount, serverUrl change) keeps
  // its session instead of hitting "Session not found". A reconnect within the window
  // cancels the pending teardown; an abandoned session is reaped once it elapses.
  const pendingCleanups = new Map<string, ReturnType<typeof setTimeout>>()

  function cancelPendingCleanup(sessionId: string): void {
    const timer = pendingCleanups.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      pendingCleanups.delete(sessionId)
    }
  }

  function teardownSession(sessionId: string): void {
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
  }

  // Drop any outstanding timers on shutdown so they neither keep the event loop alive
  // nor fire after the server has closed (also keeps integration tests isolated).
  app.addHook('onClose', async () => {
    for (const timer of pendingCleanups.values()) clearTimeout(timer)
    pendingCleanups.clear()
  })

  app.get<{ Params: { id: string } }>(
    '/ws/sessions/:id',
    { websocket: true as const, ...(effectiveAuthHook ? { preHandler: effectiveAuthHook } : {}) },
    async (socket, req) => {
      const sessionId = req.params.id

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      if (!UUID_RE.test(sessionId)) {
        socket.send(JSON.stringify({ type: 'error', content: 'Invalid session ID' }))
        socket.close(1008)
        return
      }

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

      // Reconnect within the grace window: cancel the teardown scheduled by the prior disconnect.
      cancelPendingCleanup(sessionId)

      wsSessions.set(sessionId, socket)

      socket.on('close', () => {
        // A newer reconnect may have already replaced this socket — ignore the stale close.
        if (wsSessions.get(sessionId) !== socket) return
        wsSessions.delete(sessionId)

        // Defer teardown by the grace window; a reconnect cancels it before it fires.
        cancelPendingCleanup(sessionId)
        const timer = setTimeout(() => {
          pendingCleanups.delete(sessionId)
          // A socket may have reconnected after the timer was scheduled but before it fired.
          if (wsSessions.has(sessionId)) return
          teardownSession(sessionId)
        }, cleanupGraceMs)
        timer.unref()
        pendingCleanups.set(sessionId, timer)
      })

      socket.send(JSON.stringify({ type: 'connected', sessionId }))
    }
  )
}
