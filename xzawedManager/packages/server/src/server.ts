import Fastify from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import type { Config } from './config.js'
import { registerJwt, verifyServiceToken } from './auth/jwt.plugin.js'
import { healthRoute } from './api/health.route.js'
import { sessionsRoute } from './api/sessions.route.js'
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

export async function buildServer(
  config: Config,
): Promise<{ app: ReturnType<typeof Fastify>; closeAll: () => void }> {
  const app = Fastify({ logger: config.MODE === 'local' })

  if (config.SERVICE_JWT_SECRET) {
    await registerJwt(app, config.SERVICE_JWT_SECRET)
  }

  let sessionRepo: SessionRepo | undefined
  if (config.DATABASE_URL) {
    const pool = createPool(config.DATABASE_URL)
    await runMigrations(pool)
    sessionRepo = new SessionRepo(pool)
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

  const registry = new ToolRegistry()
  registry.register(createPlanTaskHandler(config.REDIS_URL))
  registry.register(createDevelopCodeHandler(config.REDIS_URL))
  registry.register(createDesignUiHandler(config.REDIS_URL))
  registry.register(createRunTestsHandler(config.REDIS_URL))
  registry.register(createBuildProjectHandler(config.REDIS_URL))
  registry.register(createWatchChangesHandler(config.REDIS_URL))
  registry.register(createSecurityAuditHandler(config.REDIS_URL))

  const runner = new ClaudeRunner(client, config.CLAUDE_MODEL, registry)
  const producer = new StreamProducer(config.REDIS_URL)
  const sessionStore = new SessionStore(sessionRepo)
  const activeConsumers = new Map<string, StreamConsumer>()

  const authHook = config.SERVICE_JWT_SECRET ? verifyServiceToken : undefined

  await app.register(healthRoute)
  await app.register(sessionsRoute, {
    redisUrl: config.REDIS_URL,
    runner,
    producer,
    sessionStore,
    activeConsumers,
    ...(authHook && { authHook }),
  })

  const closeAll = () => {
    for (const c of activeConsumers.values()) c.stop()
    void closePool()
  }

  return { app, closeAll }
}
