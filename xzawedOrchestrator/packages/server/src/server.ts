import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import type { WebSocket } from 'ws'
import type { Config } from './config.js'
import type { ClaudeRunner } from './claude/runner.interface.js'
import { SessionStore } from './sessions/session.store.js'
import { createRunner } from './claude/runner.factory.js'
import { ManagerClient } from './manager/manager.client.js'
import { StreamProducer } from './streams/producer.js'
import { StreamConsumer } from './streams/consumer.js'
import { healthRoutes } from './api/health.route.js'
import { sessionsRoutes } from './api/sessions.route.js'
import { sessionWsRoutes } from './ws/session.ws.js'

export async function buildServer(config: Config, runnerOverride?: ClaudeRunner): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.mode !== 'local' })
  const store = new SessionStore()
  const runner = runnerOverride ?? createRunner(config)
  const manager = new ManagerClient(config.managerUrl)
  const producer = new StreamProducer(config.redisUrl)
  const wsSessions = new Map<string, WebSocket>()
  const sessionConsumers = new Map<string, StreamConsumer>()
  const sessionCleanup = new Map<string, () => void>()

  await app.register(cors, { origin: true })
  await app.register(websocket)
  await app.register(healthRoutes)
  await app.register(sessionsRoutes, { store, runner, wsSessions, manager, redisUrl: config.redisUrl, producer, sessionConsumers, sessionCleanup })
  await app.register(sessionWsRoutes, { store, wsSessions, sessionConsumers, sessionCleanup })

  return app
}
