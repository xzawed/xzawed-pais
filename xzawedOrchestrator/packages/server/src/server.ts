import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import jwtPlugin from '@fastify/jwt'
import staticPlugin from '@fastify/static'
import Anthropic from '@anthropic-ai/sdk'
import type { WebSocket } from 'ws'
import type { Config } from './config.js'
import type { ClaudeRunner } from './claude/runner.interface.js'
import { InMemorySessionStore } from './sessions/session.store.js'
import { PgSessionStore } from './sessions/pg-session.store.js'
import { makeUserAuthHook } from './auth/user-auth.hook.js'
import { createRunner } from './claude/runner.factory.js'
import { ManagerClient } from './manager/manager.client.js'
import { StreamProducer } from './streams/producer.js'
import { StreamConsumer } from './streams/consumer.js'
import { healthRoutes } from './api/health.route.js'
import { sessionsRoutes } from './api/sessions.route.js'
import { sessionWsRoutes } from './ws/session.ws.js'
import { authRoutes } from './api/auth.route.js'
import { projectsRoutes } from './api/projects.route.js'
import { createPool, runMigrations, closePool } from './db/pool.js'

const JWT_ERRORS: Record<string, string> = {
  FST_JWT_NO_AUTHORIZATION_IN_HEADER: 'Missing token',
  FST_JWT_AUTHORIZATION_TOKEN_EXPIRED: 'Token expired',
}

export async function buildServer(config: Config, runnerOverride?: ClaudeRunner): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.mode !== 'local' })

  let dbPool = null as import('pg').Pool | null
  if (config.databaseUrl) {
    dbPool = createPool(config.databaseUrl)
    await runMigrations(dbPool)
    app.addHook('onClose', async () => { await closePool() })
  }

  const store = dbPool ? new PgSessionStore(dbPool) : new InMemorySessionStore()
  const runner = runnerOverride ?? createRunner(config)
  const manager = new ManagerClient(config.managerUrl)
  const producer = new StreamProducer(config.redisUrl)
  const wsSessions = new Map<string, WebSocket>()
  const sessionConsumers = new Map<string, StreamConsumer>()
  const sessionCleanup = new Map<string, () => void>()
  const anthropicClient = config.anthropicApiKey
    ? new Anthropic({ apiKey: config.anthropicApiKey })
    : undefined

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  await app.register(cors, {
    origin: config.mode === 'local' ? false : (allowedOrigins.length > 0 ? allowedOrigins : false),
  })

  if (config.auth === 'jwt' && config.serviceJwtSecret) {
    await app.register(jwtPlugin, { secret: config.serviceJwtSecret })
  }

  const authHook = config.auth === 'jwt'
    ? async (req: FastifyRequest, reply: FastifyReply) => {
        await req.jwtVerify().catch(async (err: unknown) => {
          const code = (err as { code?: string }).code ?? ''
          await reply.status(401).send({ error: JWT_ERRORS[code] ?? 'Invalid token' })
        })
      }
    : undefined

  await app.register(websocket)
  await app.register(healthRoutes)
  if (dbPool && config.userJwtSecret) {
    await app.register(authRoutes, { pool: dbPool, userJwtSecret: config.userJwtSecret })
    await app.register(projectsRoutes, { pool: dbPool, userJwtSecret: config.userJwtSecret })
  }
  const userAuthHook = (dbPool && config.userJwtSecret)
    ? makeUserAuthHook(config.userJwtSecret)
    : undefined

  await app.register(sessionsRoutes, {
    store, runner, wsSessions, manager,
    redisUrl: config.redisUrl, producer, sessionConsumers, sessionCleanup,
    anthropicClient,
    claudeModel: config.claudeModel,
    authHook,
    pool: dbPool ?? undefined,
    userAuthHook,
  })
  await app.register(sessionWsRoutes, { store, wsSessions, sessionConsumers, sessionCleanup, authHook, userAuthHook })

  if (config.serveWeb) {
    const webDist = join(fileURLToPath(import.meta.url), '../../../../web/dist')
    await app.register(staticPlugin, { root: webDist, prefix: '/' })
    app.setNotFoundHandler((_req, reply) => {
      void reply.sendFile('index.html')
    })
  }

  return app
}
