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
import { StreamProducer } from './streams/producer.js'
import { StreamConsumer } from './streams/consumer.js'
import { healthRoutes } from './api/health.route.js'
import { sessionsRoutes } from './api/sessions.route.js'
import { sessionWsRoutes } from './ws/session.ws.js'
import { authRoutes } from './api/auth.route.js'
import { projectsRoutes } from './api/projects.route.js'
import { internalRoutes } from './api/internal.route.js'
import { createPool, runMigrations, closePool } from './db/pool.js'
import { ProjectGatewayConsumer } from './projects/project-gateway.js'
import { ProjectRepo } from './projects/project.repo.js'
import { WorkspaceService } from './projects/workspace.service.js'

const JWT_ERRORS: Record<string, string> = {
  FST_JWT_NO_AUTHORIZATION_IN_HEADER: 'Missing token',
  FST_JWT_AUTHORIZATION_TOKEN_EXPIRED: 'Token expired',
}

function makeJwtAuthHook(
  config: Config,
): ((req: FastifyRequest, reply: FastifyReply) => Promise<void>) | undefined {
  if (config.auth !== 'jwt') return undefined
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await req.jwtVerify().catch(async (err: unknown) => {
      const code = (err as { code?: string }).code ?? ''
      await reply.status(401).send({ error: JWT_ERRORS[code] ?? 'Invalid token' })
    })
  }
}

async function setupDatabase(
  app: FastifyInstance,
  config: Config,
): Promise<import('pg').Pool | null> {
  if (!config.databaseUrl) return null
  const dbPool = createPool(config.databaseUrl)
  await runMigrations(dbPool)
  app.addHook('onClose', async () => { await closePool() })
  return dbPool
}

async function registerAuthRoutes(
  app: FastifyInstance,
  dbPool: import('pg').Pool,
  config: Config,
): Promise<void> {
  await app.register(authRoutes, { pool: dbPool, userJwtSecret: config.userJwtSecret! })
  await app.register(projectsRoutes, {
    pool: dbPool,
    userJwtSecret: config.userJwtSecret!,
    githubTokenEncryptionKey: config.githubTokenKey,
  })
}

export async function buildServer(config: Config, runnerOverride?: ClaudeRunner): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.mode !== 'local' })
  const dbPool = await setupDatabase(app, config)

  const store = dbPool ? new PgSessionStore(dbPool) : new InMemorySessionStore()
  const runner = runnerOverride ?? createRunner(config)
  const producer = new StreamProducer(config.redisUrl)
  const wsSessions = new Map<string, WebSocket>()
  const sessionConsumers = new Map<string, StreamConsumer>()
  const sessionCleanup = new Map<string, () => void>()
  const anthropicClient = config.anthropicApiKey
    ? new Anthropic({ apiKey: config.anthropicApiKey })
    : undefined

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  let corsOrigin: string[] | false = false
  if (config.mode !== 'local' && allowedOrigins.length > 0) {
    corsOrigin = allowedOrigins
  }
  await app.register(cors, { origin: corsOrigin })

  if (config.auth === 'jwt' && config.serviceJwtSecret) {
    await app.register(jwtPlugin, { secret: config.serviceJwtSecret })
  }

  const authHook = makeJwtAuthHook(config)

  await app.register(websocket)
  await app.register(healthRoutes)
  if (dbPool && config.userJwtSecret) {
    await registerAuthRoutes(app, dbPool, config)
  }
  const userAuthHook = (dbPool && config.userJwtSecret)
    ? makeUserAuthHook(config.userJwtSecret)
    : undefined

  await app.register(sessionsRoutes, {
    store, runner, wsSessions,
    redisUrl: config.redisUrl, producer, sessionConsumers, sessionCleanup,
    anthropicClient,
    claudeModel: config.claudeModel,
    authHook,
    pool: dbPool ?? undefined,
    userAuthHook,
  })
  await app.register(sessionWsRoutes, { store, wsSessions, sessionConsumers, sessionCleanup, authHook, userAuthHook })

  if (dbPool) {
    if (authHook) {
      await app.register(internalRoutes, { pool: dbPool, authHook, store })
    } else {
      app.log.warn('Internal routes disabled: AUTH=jwt is required to expose internal endpoints')
    }

    const projectRepo = new ProjectRepo(dbPool)
    const workspaceSvc = new WorkspaceService()
    const projectGateway = new ProjectGatewayConsumer(
      config.redisUrl,
      async (sessionId, payload) => {
        const session = await store.findById(sessionId)
        if (!session) throw new Error('Session not found')

        const project = await projectRepo.create(session.userId, payload.name, { description: payload.description })

        let workspacePath: string | undefined
        let status: 'registered' | 'cloning' = 'registered'

        if (payload.workspaceType === 'local') {
          if (!payload.localPath) throw new Error('localPath required')
          await workspaceSvc.validateLocalPath(payload.localPath)
          workspacePath = payload.localPath
        } else if (payload.workspaceType === 'github') {
          if (!payload.repoUrl) throw new Error('repoUrl required')
          const parsedUrl = new URL(payload.repoUrl)
          if (parsedUrl.protocol !== 'https:') {
            throw new Error('repoUrl must use https protocol')
          }
          workspacePath = workspaceSvc.clonePath(project.id)
          void workspaceSvc.cloneRepo(payload.repoUrl, workspacePath, payload.branch ?? 'main').catch((err: unknown) => {
            app.log.error({ err }, 'background git clone failed')
          })
          status = 'cloning'
        }

        await projectRepo.updateWorkspace(project.id, {
          workspaceType: payload.workspaceType,
          localPath: payload.localPath,
          repoUrl: payload.repoUrl,
          branch: payload.branch,
          workspacePath,
          pushStrategy: 'push',
        })

        await store.updateProject(sessionId, project.id)

        return { projectId: project.id, workspacePath: workspacePath ?? null, status }
      },
      async (sessionId, payload) => {
        const session = await store.findById(sessionId)
        if (!session) throw new Error('Session not found')

        let project: Awaited<ReturnType<typeof projectRepo.findByIdAndUser>> | undefined

        if (payload.projectId) {
          project = await projectRepo.findByIdAndUser(payload.projectId, session.userId)
        } else if (payload.name) {
          const all = await projectRepo.findByUser(session.userId)
          project = all.find(p => p.name === payload.name || p.slug === payload.name)
        }

        if (!project) throw new Error('Project not found')

        await store.updateProject(sessionId, project.id)

        return { projectId: project.id, name: project.name, workspacePath: project.workspace_path ?? null }
      },
    )
    void projectGateway.start().catch((err: unknown) => {
      app.log.error({ err }, '[Orchestrator] ProjectGatewayConsumer crashed')
    })
    app.addHook('onClose', async () => { projectGateway.stop() })
  }

  if (config.serveWeb) {
    const webDist = join(fileURLToPath(import.meta.url), '../../../../web/dist')
    await app.register(staticPlugin, { root: webDist, prefix: '/' })
    app.setNotFoundHandler((_req, reply) => {
      const result: unknown = reply.sendFile('index.html')
      if (result instanceof Promise) {
        result.catch((err: unknown) => {
          app.log.error(err, 'Failed to send index.html')
        })
      }
    })
  }

  return app
}
