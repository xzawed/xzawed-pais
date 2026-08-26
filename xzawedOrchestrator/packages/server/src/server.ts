import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply, type FastifyError } from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import jwtPlugin from '@fastify/jwt'
import staticPlugin from '@fastify/static'
import Anthropic from '@anthropic-ai/sdk'
import type { WebSocket } from 'ws'
import { DEFAULT_WS_CLEANUP_GRACE_MS, type Config } from './config.js'
import type { ClaudeRunner } from './claude/runner.interface.js'
import { parseLocale, type LocalizedRequest } from './i18n/server-i18n.js'
import { InMemorySessionStore } from './sessions/session.store.js'
import { PgSessionStore } from './sessions/pg-session.store.js'
import { makeUserAuthHook } from './auth/user-auth.hook.js'
import { createRunner } from './claude/runner.factory.js'
import { StreamProducer } from './streams/producer.js'
import { StreamConsumer } from './streams/consumer.js'
import { healthRoutes } from './api/health.route.js'
import { getRedisClient, getProbeRedisClient } from './streams/redis.client.js'
import { knowledgeRoutes } from './api/knowledge.route.js'
import { decisionsRoutes } from './api/decisions.route.js'
import { sessionsRoutes } from './api/sessions.route.js'
import { sessionWsRoutes } from './ws/session.ws.js'
import { authRoutes } from './api/auth.route.js'
import { projectsRoutes } from './api/projects.route.js'
import { internalRoutes } from './api/internal.route.js'
import { createPool, runMigrations, closePool, getPool } from './db/pool.js'
import { ProjectGatewayConsumer } from './projects/project-gateway.js'
import { ProjectRepo } from './projects/project.repo.js'
import { WorkspaceService } from './projects/workspace.service.js'
import { normalizeWorkspacePath, assertReadableDirectory } from './projects/workspace-path.js'

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

async function registerAuthStub(app: FastifyInstance): Promise<void> {
  // AUTH=none: stub /auth/me so clients receive { user: null } instead of 404
  app.get('/auth/me', async (_req, reply) => reply.code(200).send({ user: null }))
}

/** 로컬호스트 Origin 인지(포트 무관). Electron dev 렌더러가 vite 포트에서 온다. */
export function isLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

/**
 * CORS Origin 판정.
 *
 * 이전엔 `MODE=local`에서 `origin: true`였다 — **어떤 웹사이트든** 사용자의 브라우저를 통해
 * 로컬 서버를 호출할 수 있었다는 뜻이다(로컬 서버의 고전적 CSRF·DNS rebinding 표면).
 *
 * 좁히되 Electron 경로는 명시 보존한다.
 * - Origin 헤더가 없으면 CORS 요청이 아니다(Electron 프로덕션의 `file://`, 서버 간 호출) → 허용
 * - `null` 문자열 Origin 도 `file://` 문서가 보내는 값이라 로컬 모드에서 허용
 * - 로컬 모드는 로컬호스트 Origin 을 포트 무관 허용(vite dev 서버 포트가 바뀌어도 동작)
 * - `ALLOWED_ORIGINS` 는 두 모드 모두에서 추가 허용
 * - 원격 모드는 `ALLOWED_ORIGINS` 만 허용하고, 비어 있으면 기동 자체가 거부된다(config)
 */
export function makeCorsOriginCheck(config: Config) {
  const allow = new Set(config.allowedOrigins)
  return (origin: string | undefined, cb: (err: Error | null, ok: boolean) => void): void => {
    if (origin === undefined) return cb(null, true)
    if (allow.has(origin)) return cb(null, true)
    if (config.mode === 'local' && (origin === 'null' || isLocalhostOrigin(origin))) return cb(null, true)
    cb(null, false)
  }
}

export async function buildServer(config: Config, runnerOverride?: ClaudeRunner): Promise<FastifyInstance> {
  // trustProxy 를 하드코딩하지 않는다. 켜면 Fastify 가 X-Forwarded-For 를 클라이언트 IP 로
  // 채택하는데, 프록시 뒤가 아니면 **클라이언트가 그 헤더를 마음대로 보낼 수 있다** —
  // rate limit 키가 IP 라 매 요청 헤더를 바꾸면 로그인 시도 제한이 통째로 무력화된다.
  const app = Fastify({ logger: config.mode !== 'local', trustProxy: config.trustProxy })
  const dbPool = await setupDatabase(app, config)

  // jscpd:ignore-start
  // replicated-block: fastify-error-envelope
  // Manager와 오류 봉투 모양이 갈리면 클라이언트가 서비스마다 다른 형태를 받는다.
  // 사유와 강제 방법: scripts/check-replicated-blocks.js
  app.setErrorHandler<FastifyError>((err, req, reply) => {
    app.log.error({ err, url: req.url }, 'Unhandled error')
    const statusCode = err.statusCode ?? 500
    if (statusCode >= 500) {
      return reply.status(500).send({ error: 'Internal Server Error' })
    }
    const errorField = (err as unknown as { error?: string }).error ?? err.message
    return reply.status(statusCode).send({ error: errorField })
  })
  // jscpd:ignore-end

  app.addHook('preHandler', async (request) => {
    const header = request.headers['accept-language']
    ;(request as FastifyRequest & LocalizedRequest).locale =
      parseLocale(header as string | undefined)
  })

  const store = dbPool ? new PgSessionStore(dbPool) : new InMemorySessionStore()
  const runner = runnerOverride ?? createRunner(config)
  const producer = new StreamProducer(config.redisUrl)
  const wsSessions = new Map<string, WebSocket>()
  const sessionConsumers = new Map<string, StreamConsumer>()
  const sessionCleanup = new Map<string, () => void>()

  // 종료 시 세션별 소비자 루프를 세운다. 이 루프들은 공유 Redis 연결 위에서 블로킹
  // XREADGROUP 을 돌기 때문에, 살아 있는 채로 연결을 quit 하면 루프가 종료가 아니라
  // 에러 백오프 재시도로 떨어져 이벤트 루프를 붙잡는다.
  // onClose 는 등록 역순(LIFO — 실측)이라 이 훅은 등록 1번째인 closePool 보다 **먼저**
  // 돈다 — 소비자가 아직 DB 를 만질 수 있는데 풀이 먼저 닫히는 일은 없다.
  app.addHook('onClose', async () => {
    for (const consumer of sessionConsumers.values()) consumer.stop()
    sessionConsumers.clear()
  })
  const anthropicClient = config.anthropicApiKey
    ? new Anthropic({ apiKey: config.anthropicApiKey })
    : undefined

  await app.register(cors, { origin: makeCorsOriginCheck(config) })

  if (config.auth === 'jwt' && config.serviceJwtSecret) {
    await app.register(jwtPlugin, { secret: config.serviceJwtSecret })
  }

  const authHook = makeJwtAuthHook(config)

  await app.register(websocket)
  // 게이트웨이는 dbPool 이 있을 때만 아래 블록 안에서 생성된다. 블록 스코프라 여기서
  // 직접 못 보므로 ref 로 잇는다 — 없으면 undefined 이고 그것은 미구성이지 장애가 아니다.
  const projectGatewayRef: { current?: { isRunning(): boolean } } = {}

  // projectGateway 는 dbPool 이 있을 때만 아래에서 생성된다 — 접근자가 undefined 를
  // 돌려주면 미구성이고, 그것은 장애가 아니다.
  await app.register(healthRoutes, {
    // S4.3: probe 전용 연결. 공유 클라이언트는 블로킹 소비(XREADGROUP BLOCK 2000)가 점유해
    //       ping 이 readiness 예산(1000ms)을 항상 넘긴다 — 첫 세션 이후 영구 503 이었다.
    redis: () => getProbeRedisClient(config.redisUrl),
    gatewayRunning: () => projectGatewayRef.current?.isRunning(),
    pool: () => getPool(),
  })
  if (dbPool && config.userJwtSecret) {
    await registerAuthRoutes(app, dbPool, config)
  } else {
    await registerAuthStub(app)
  }
  const userAuthHook = (dbPool && config.userJwtSecret)
    ? makeUserAuthHook(config.userJwtSecret)
    : undefined

  // 위키 프록시: 쓰기 경로에 user JWT 요구(userAuthHook) + Manager 호출에 서비스 토큰 발급·전달.
  // jwtPlugin은 auth==='jwt' && serviceJwtSecret일 때만 등록되므로 app.jwt도 그 경우에만 사용.
  const signServiceToken = (config.auth === 'jwt' && config.serviceJwtSecret)
    ? (): string => app.jwt.sign({ svc: 'knowledge-proxy' }, { expiresIn: '60s' })
    : undefined
  await app.register(knowledgeRoutes, {
    managerUrl: config.managerUrl,
    ...(userAuthHook && { userAuthHook }),
    ...(signServiceToken && { signServiceToken }),
    // G11 Slice 0: 쓰기 경로 프로젝트 소유권 게이트(IDOR 폐색). userAuthHook+dbPool 동반 시만 배선.
    ...(dbPool && { pool: dbPool }),
  })
  const signDecisionToken = (config.auth === 'jwt' && config.serviceJwtSecret)
    ? (): string => app.jwt.sign({ svc: 'decision-proxy' }, { expiresIn: '60s' })
    : undefined
  await app.register(decisionsRoutes, {
    managerUrl: config.managerUrl,
    ...(userAuthHook && { userAuthHook }),
    ...(signDecisionToken && { signServiceToken: signDecisionToken }),
    // G11 Slice 0: 제출(POST) 프로젝트 소유권 게이트(IDOR 폐색). userAuthHook+dbPool 동반 시만 배선.
    ...(dbPool && { pool: dbPool }),
  })

  await app.register(sessionsRoutes, {
    store, runner, wsSessions,
    redisUrl: config.redisUrl, producer, sessionConsumers, sessionCleanup,
    anthropicClient,
    claudeModel: config.claudeModel,
    authHook,
    pool: dbPool ?? undefined,
    userAuthHook,
    decomposeEnabled: config.decomposeEnabled,
  })
  // Clamp the grace to setTimeout's valid range: NaN/negative falls back to the default,
  // and oversized values are capped at the 32-bit ceiling so a misconfigured grace can't
  // silently collapse to ~1ms (Node clamps out-of-range delays) and defeat the feature.
  const MAX_TIMEOUT_MS = 2_147_483_647
  const rawGrace = config.wsCleanupGraceMs
  const wsCleanupGraceMs = typeof rawGrace === 'number' && Number.isFinite(rawGrace) && rawGrace >= 0
    ? Math.min(rawGrace, MAX_TIMEOUT_MS)
    : DEFAULT_WS_CLEANUP_GRACE_MS
  await app.register(sessionWsRoutes, { store, wsSessions, sessionConsumers, sessionCleanup, cleanupGraceMs: wsCleanupGraceMs, authHook, userAuthHook })

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

        // **LLM 이 register_project 도구로 localPath 를 정하는 경로다.** 판정은 HTTP
        // 진입점 둘과 같은 단일 출처를 쓴다. throw 는 RPC 에러가 되므로 별도 매핑이 없다.
        // 검증이 projectRepo.create() 앞이라 실패 시 고아 프로젝트 행이 남지 않는다.
        let normalizedLocalPath: string | undefined
        // repoUrl 검사도 create 앞으로 옮겨졌으므로 좁혀진 값을 여기 담아 넘긴다.
        let validatedRepoUrl: string | undefined
        if (payload.workspaceType === 'local') {
          if (!payload.localPath) throw new Error('localPath required')
          normalizedLocalPath = normalizeWorkspacePath(payload.localPath)
          await assertReadableDirectory(normalizedLocalPath)
        } else if (payload.workspaceType === 'github') {
          if (!payload.repoUrl) throw new Error('repoUrl required')
          const parsedUrl = new URL(payload.repoUrl)
          if (parsedUrl.protocol !== 'https:') {
            throw new Error('repoUrl must use https protocol')
          }
          validatedRepoUrl = payload.repoUrl
        }

        const project = await projectRepo.create(session.userId, payload.name, { description: payload.description })

        let workspacePath: string | undefined
        let status: 'registered' | 'cloning' = 'registered'

        if (payload.workspaceType === 'local') {
          workspacePath = normalizedLocalPath
        } else if (payload.workspaceType === 'github' && validatedRepoUrl !== undefined) {
          // clone 목적지는 Layer 1 만 — 아래가 `void cloneRepo(...)` 라 아직 존재하지 않는다.
          workspacePath = normalizeWorkspacePath(workspaceSvc.clonePath(project.id))
          void workspaceSvc.cloneRepo(validatedRepoUrl, workspacePath, payload.branch ?? 'main').catch(async (err: unknown) => {
            app.log.error({ err }, 'background git clone failed')
            await projectRepo.updateWorkspace(project.id, {
              workspaceType: 'github',
              localPath: normalizedLocalPath ?? payload.localPath,
              repoUrl: payload.repoUrl,
              branch: payload.branch,
              workspacePath: undefined,
              pushStrategy: 'push',
            }).catch((updateErr: unknown) => {
              app.log.error({ err: updateErr }, 'failed to reset workspace_path after clone failure')
            })
          })
          status = 'cloning'
        }

        await projectRepo.updateWorkspace(project.id, {
          workspaceType: payload.workspaceType,
          localPath: normalizedLocalPath ?? payload.localPath,
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
    projectGatewayRef.current = projectGateway
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
