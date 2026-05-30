import Fastify, { type FastifyError } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import type { Config } from './config.js'
import { registerJwt, verifyServiceToken } from './auth/jwt.plugin.js'
import { healthRoute } from './api/health.route.js'
import { sessionsRoute, makeSessionStarter } from './api/sessions.route.js'
import { StreamProducer } from './streams/producer.js'
import { StreamConsumer } from './streams/consumer.js'
import { SessionStore } from './sessions/session.store.js'
import { SessionRepo } from './db/session.repo.js'
import { createPool, runMigrations, closePool } from './db/pool.js'
import { ToolRegistry } from './tools/registry.js'
import { ClaudeRunner } from './claude/runner.js'
import { createPlanTaskHandler } from './tools/plan-task.js'
import { createDevelopCodeHandler } from './tools/develop-code.js'
import { createDesignUiHandler } from './tools/design-ui.js'
import { createRunTestsHandler } from './tools/run-tests.js'
import { createBuildProjectHandler } from './tools/build-project.js'
import { createWatchChangesHandler } from './tools/watch-changes.js'
import { createSecurityAuditHandler } from './tools/security-audit.js'
import { createGithubOpsHandler } from './tools/github-ops.js'
import { createRegisterProjectHandler } from './tools/register-project.js'
import { createSwitchProjectHandler } from './tools/switch-project.js'
import { createDeployProjectHandler } from './tools/deploy-project.js'
import { SessionGatewayConsumer } from './streams/session-gateway.js'
import { WatcherEventConsumer } from './streams/watcher-event-consumer.js'
import { getRedisClient } from './streams/redis.client.js'

export async function buildServer(
  config: Config,
): Promise<{ app: ReturnType<typeof Fastify>; closeAll: () => Promise<void> }> {
  const app = Fastify({ logger: config.MODE === 'local', trustProxy: true })

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    app.log.error({ err, url: req.url }, 'Unhandled error')
    const statusCode = err.statusCode ?? 500
    if (statusCode >= 500) {
      return reply.status(500).send({ error: 'Internal Server Error' })
    }
    const errorField = (err as unknown as { error?: string }).error ?? err.message
    return reply.status(statusCode).send({ error: errorField })
  })

  if (config.SERVICE_JWT_SECRET) {
    await registerJwt(app, config.SERVICE_JWT_SECRET)
  }

  let sessionRepo: SessionRepo | undefined
  if (config.DATABASE_URL) {
    const pool = createPool(config.DATABASE_URL)
    await runMigrations(pool)
    sessionRepo = new SessionRepo(pool)
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 3 })

  const registry = new ToolRegistry()
  registry.register(createPlanTaskHandler(config.REDIS_URL))
  registry.register(createDevelopCodeHandler(config.REDIS_URL))
  registry.register(createDesignUiHandler(config.REDIS_URL))
  registry.register(createRunTestsHandler(config.REDIS_URL))
  registry.register(createBuildProjectHandler(config.REDIS_URL))
  registry.register(createWatchChangesHandler(config.REDIS_URL))
  registry.register(createSecurityAuditHandler(config.REDIS_URL))
  if (config.GITHUB_TOKEN) {
    registry.register(createGithubOpsHandler(config.GITHUB_TOKEN))
    registry.register(createDeployProjectHandler(config.GITHUB_TOKEN, config.REDIS_URL))
  } else {
    app.log.warn(
      'GITHUB_TOKEN이 설정되지 않았습니다. GitHub 관련 작업(repo 생성, 코드 push, PR 생성 등)을 요청하면 "Unknown tool: github_ops" 오류가 발생합니다. .env 파일에 GITHUB_TOKEN을 추가하세요.',
    )
  }
  // ORCHESTRATOR_URL 조건 제거: Redis URL만 필요
  registry.register(createRegisterProjectHandler(config.REDIS_URL))
  registry.register(createSwitchProjectHandler(config.REDIS_URL))

  const runner = new ClaudeRunner(client, config.CLAUDE_MODEL, registry)
  const producer = new StreamProducer(config.REDIS_URL)
  const sessionStore = new SessionStore(sessionRepo)
  const activeConsumers = new Map<string, StreamConsumer>()

  const authHook = config.SERVICE_JWT_SECRET ? verifyServiceToken : undefined

  const watcherEventConsumer = new WatcherEventConsumer(
    config.REDIS_URL,
    async (event) => {
      app.log.info(
        { sessionId: event.sessionId, path: event.path, event: event.event },
        '[watcher] file_changed 이벤트 수신 — 빌드/테스트 자동 재실행'
      )
      // file_changed → orchestrator:to-manager:{sessionId}에 task_request 발행
      // Manager가 이를 새 태스크로 처리하여 빌드/테스트를 자동 실행
      try {
        const requestStream = `orchestrator:to-manager:${event.sessionId}`
        const redis = getRedisClient(config.REDIS_URL)
        await redis.xadd(requestStream, '*', 'data', JSON.stringify({
          sessionId: event.sessionId,
          messageId: crypto.randomUUID(),
          timestamp: Date.now(),
          type: 'task_request',
          payload: {
            intent: `파일 변경 감지: ${event.path} (${event.event}). 변경된 파일을 기반으로 빌드와 테스트를 자동으로 실행합니다.`,
            context: {
              triggeredBy: 'file_changed',
              changedFile: event.path,
              changeType: event.event,
            },
            priority: 'normal',
          },
        }))
      } catch (err) {
        app.log.error({ err, sessionId: event.sessionId }, '[watcher] task_request 발행 실패')
      }
    }
  )
  watcherEventConsumer.start()

  await app.register(healthRoute)
  await app.register(sessionsRoute, {
    redisUrl: config.REDIS_URL,
    runner,
    producer,
    sessionStore,
    registry,
    activeConsumers,
    watcherEventConsumer,
    ...(authHook && { authHook }),
  })

  const startManagedSession = makeSessionStarter({
    redisUrl: config.REDIS_URL, runner, producer, sessionStore, activeConsumers,
    watcherEventConsumer,
    log: { error: (obj, msg) => app.log.error(obj, msg) },
  })

  const sessionGateway = new SessionGatewayConsumer(config.REDIS_URL, startManagedSession)
  void sessionGateway.start().catch((err: unknown) => {
    app.log.error({ err }, 'SessionGatewayConsumer crashed')
  })

  const closeAll = async () => {
    sessionGateway.stop()
    watcherEventConsumer.stop()
    for (const c of activeConsumers.values()) c.stop()
    await registry.closeAll()
    await closePool()
  }

  return { app, closeAll }
}
