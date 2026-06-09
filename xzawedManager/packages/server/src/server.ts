import Fastify, { type FastifyError } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import type { Config } from './config.js'
import { registerJwt, verifyServiceToken } from './auth/jwt.plugin.js'
import { healthRoute } from './api/health.route.js'
import { knowledgeRoute } from './api/knowledge.route.js'
import { sessionsRoute, makeSessionStarter } from './api/sessions.route.js'
import { StreamProducer } from './streams/producer.js'
import { StreamConsumer } from './streams/consumer.js'
import { SessionStore } from './sessions/session.store.js'
import { SessionRepo } from './db/session.repo.js'
import { KnowledgeRepo } from './db/knowledge.repo.js'
import { EventStore } from './db/event-store.js'
import { OutboxRelay } from './streams/outbox-relay.js'
import { createPool, runMigrations, closePool } from './db/pool.js'
import type { Pool } from 'pg'
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
import { getRedisClient, createRedisClient } from './streams/redis.client.js'
import { RedisEventBus } from '@xzawed/agent-streams'
import { TaskGraphRepo } from './db/task-graph.repo.js'
import { DispatchStore } from './db/dispatch.repo.js'
import { LeaseStore } from './db/lease.repo.js'
import { OracleRepo } from './db/oracle.repo.js'
import { oracleRoute } from './api/oracle.route.js'
import { createSupervisor, shouldWireSupervisor, type Supervisor } from './streams/supervisor.js'
import type { ProduceDeps } from './decompose/producer.js'

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
  let knowledgeRepo: KnowledgeRepo | undefined
  let eventStore: EventStore | undefined
  let pool: Pool | undefined
  if (config.DATABASE_URL) {
    pool = createPool(config.DATABASE_URL)
    await runMigrations(pool)
    sessionRepo = new SessionRepo(pool)
    knowledgeRepo = new KnowledgeRepo(pool)
    if (config.EVENT_SOURCED_SESSION) eventStore = new EventStore(pool)
  } else if (config.EVENT_SOURCED_SESSION) {
    app.log.warn('EVENT_SOURCED_SESSION=true 이지만 DATABASE_URL이 없어 인메모리 폴백으로 동작합니다.')
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

  const runner = new ClaudeRunner(client, config.CLAUDE_MODEL, registry, knowledgeRepo)
  const producer = new StreamProducer(config.REDIS_URL)
  const sessionStore = new SessionStore(sessionRepo, eventStore)
  const activeConsumers = new Map<string, StreamConsumer>()

  // 이벤트소싱 활성 시: 시작 시 이벤트 로그에서 세션 투영 복원(eventStore 필요)
  let outboxRelay: OutboxRelay | undefined
  if (eventStore && pool) {
    const restored = await eventStore.replaySessions()
    for (const [sid, s] of restored) sessionStore.restoreSession(sid, s.state, s.lastEventId, s.count)
    app.log.info(`[event-sourcing] ${restored.size}개 세션 상태 replay 복원`)
  }
  // 아웃박스 릴레이: 아웃박스를 쓰는 어떤 기능이라도 켜지면 가동. Task Manager 디스패치(wp.dispatched)·
  // P3-1 oracle.approved 발행은 EVENT_SOURCED_SESSION과 독립이므로 relay 기동을 그와 분리한다 — 미기동 시
  // 아웃박스 행이 published_at=NULL로 영구 잔류해 재디스패치가 트리거되지 않는다.
  // D3: MANAGER_ORACLE_DRAFT 포함 — DRAFT-only에서 사람이 approve 시 생기는 oracle.approved 아웃박스가
  // published_at=NULL로 잔류하지 않도록 relay를 함께 가동(approve 전이는 flag 무관 always-on).
  if (
    pool &&
    (config.EVENT_SOURCED_SESSION ||
      config.TASK_MANAGER_ENABLED ||
      config.MANAGER_ORACLE_DOR ||
      config.MANAGER_ORACLE_DRAFT)
  ) {
    outboxRelay = new OutboxRelay(pool, producer, config.MANAGER_OUTBOX_POLL_MS)
    outboxRelay.start()
  }

  // P3-2: oracleStore는 DOR||DRAFT일 때 한 번만 생성해 Supervisor(consumer upsert·satisfied-set)와
  // oracleRoute(작성·승인·조회)에 공유한다(중복 OracleRepo 제거). DoR 게이트(satisfied-set·oracleConsumer)는
  // createSupervisor가 config.oracleDor로 분리 — DRAFT만 켜면 영속만, DoR off.
  const oracleStore =
    pool && (config.MANAGER_ORACLE_DOR || config.MANAGER_ORACLE_DRAFT) ? new OracleRepo(pool) : undefined

  // D5: 초안 영속은 decomposition consumer(=Supervisor)가 돌아야 하므로 TASK_MANAGER_ENABLED+DATABASE_URL이 전제다.
  // DRAFT만 켜고 그 전제가 없으면 producer가 oracleDrafts를 emit해도 소비자 부재로 영속되지 않는다 — 오진 방지 경고.
  if (config.MANAGER_ORACLE_DRAFT && !(config.TASK_MANAGER_ENABLED && pool)) {
    app.log.warn(
      'MANAGER_ORACLE_DRAFT=true 이지만 TASK_MANAGER_ENABLED+DATABASE_URL 전제가 없어 초안 오라클이 영속되지 않습니다(소비자 부재).',
    )
  }

  // Task Manager Supervisor 배선(P1d-7): flag on + pool이면 decomposition 소비→디스패치·lease sweep·
  // completion 소비→재디스패치를 가동. 생산자(P2) 미도착이라 빈 스트림 구독(동작 준비). flag off면 미배선.
  let supervisor: Supervisor | undefined
  const supervisorDecision = shouldWireSupervisor(config.TASK_MANAGER_ENABLED, pool !== undefined)
  if (supervisorDecision === 'wire' && pool) {
    const bus = new RedisEventBus(createRedisClient(config.REDIS_URL))
    supervisor = createSupervisor(
      () => createRedisClient(config.REDIS_URL),
      {
        repo: new TaskGraphRepo(pool),
        dispatchStore: new DispatchStore(pool),
        leaseStore: new LeaseStore(pool),
        publish: (stream, message) => bus.publish(stream, message),
        // DOR||DRAFT 공유 oracleStore. createSupervisor가 config.oracleDor로 DoR 게이트(satisfied-set·
        // oracleConsumer) 활성 여부를 분리 — DRAFT만 켜면 decompositionConsumer가 upsertDraft만 수행.
        ...(oracleStore && { oracleStore }),
      },
      {
        sweepMs: config.MANAGER_LEASE_SWEEP_MS,
        visibilityMs: config.MANAGER_LEASE_VISIBILITY_MS,
        maxAttempts: config.MANAGER_LEASE_MAX_ATTEMPTS,
        oracleDor: config.MANAGER_ORACLE_DOR,
        // P4-1: 워커 활성(=MANAGER_TASK_WORKER). handlers 맵 주입은 Task 7에서. off면 워커 미배선(회귀 0).
        taskWorker: config.MANAGER_TASK_WORKER,
      },
    )
    supervisor.start()
    app.log.info('[task-manager] Supervisor 가동(decomposition→dispatch · lease sweep · completion→re-dispatch)')
  } else if (supervisorDecision === 'warn') {
    app.log.warn('TASK_MANAGER_ENABLED=true 이지만 DATABASE_URL이 없어 Supervisor를 배선하지 않습니다.')
  }

  // P2-3a 다단계 분해 생산자(flag on): decompose_request → 4단계 LLM 분해 → decomposition.emitted 발행.
  const decompose: ProduceDeps | undefined = config.MANAGER_DECOMPOSE_ENABLED
    ? {
        claude: client,
        model: config.CLAUDE_MODEL,
        publish: (stream, message) => producer.publishRaw(stream, message),
        timeoutMs: config.CLAUDE_TIMEOUT_MS,
        repairMax: config.MANAGER_DECOMPOSE_REPAIR_MAX,
        log: (msg, data) => app.log.info(data ?? {}, msg),
        // P3-2: ok 경로에서 draft 스테이지 실행 → oracleDrafts emit(off면 []·회귀 0).
        draftOracles: config.MANAGER_ORACLE_DRAFT,
      }
    : undefined
  if (config.MANAGER_DECOMPOSE_ENABLED) {
    app.log.info('[decompose] MANAGER_DECOMPOSE_ENABLED — decompose_request 생산자 배선')
  }

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
  // 쓰기 경로(PATCH/DELETE)에만 서비스 토큰 요구(authHook). GET은 개방 유지.
  await app.register(knowledgeRoute, { ...(knowledgeRepo && { knowledgeRepo }), ...(authHook && { authHook }) })
  // P3-1/P3-2 Oracle 라우트(DOR||DRAFT·pool 시 공유 oracleStore): 작성·승인·조회. 쓰기는 authHook 설정 시 보호.
  // DRAFT-only에서도 API approve가 가능해야 drafted→human_approved 전이 + oracle.approved 아웃박스가 닫힌다.
  await app.register(oracleRoute, {
    ...(oracleStore && { oracleRepo: oracleStore }),
    ...(authHook && { authHook }),
  })
  await app.register(sessionsRoute, {
    redisUrl: config.REDIS_URL,
    runner,
    producer,
    sessionStore,
    registry,
    activeConsumers,
    watcherEventConsumer,
    ...(authHook && { authHook }),
    ...(decompose && { decompose }),
  })

  const startManagedSession = makeSessionStarter({
    redisUrl: config.REDIS_URL, runner, producer, sessionStore, activeConsumers,
    watcherEventConsumer,
    ...(decompose && { decompose }),
    log: { error: (obj, msg) => app.log.error(obj, msg) },
  })

  const sessionGateway = new SessionGatewayConsumer(config.REDIS_URL, startManagedSession)
  void sessionGateway.start().catch((err: unknown) => {
    app.log.error({ err }, 'SessionGatewayConsumer crashed')
  })

  const closeAll = async () => {
    supervisor?.stop()
    outboxRelay?.stop()
    sessionGateway.stop()
    watcherEventConsumer.stop()
    for (const c of activeConsumers.values()) c.stop()
    await registry.closeAll()
    await closePool()
  }

  return { app, closeAll }
}
