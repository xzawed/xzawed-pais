import Fastify, { type FastifyError } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import type { Config } from './config.js'
import { registerJwt, verifyServiceToken } from './auth/jwt.plugin.js'
import { healthRoute } from './api/health.route.js'
import { metricsRoute } from './api/metrics.route.js'
import { knowledgeRoute } from './api/knowledge.route.js'
import { sessionsRoute, makeSessionStarter } from './api/sessions.route.js'
import { adminRoute } from './api/admin.route.js'
import { StreamProducer } from './streams/producer.js'
import { StreamConsumer } from './streams/consumer.js'
import { SessionStore } from './sessions/session.store.js'
import { SessionRepo } from './db/session.repo.js'
import { KnowledgeRepo } from './db/knowledge.repo.js'
import { EventStore } from './db/event-store.js'
import { OutboxRelay } from './streams/outbox-relay.js'
import { createOutboxPublish } from './streams/outbox-publish.js'
import { createPool, runMigrations, closePool, getPool } from './db/pool.js'
import type { Pool } from 'pg'
import { ToolRegistry } from './tools/registry.js'
import { ClaudeRunner, type BudgetRunnerDeps, type ProviderRunnerDeps, isProviderFailure } from './claude/runner.js'
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
import { ReleaseDeployGate } from './tools/deploy-gate.js'
import { SessionGatewayConsumer } from './streams/session-gateway.js'
import { resolveThetaByRisk } from './streams/verify.js'
import { WatcherEventConsumer } from './streams/watcher-event-consumer.js'
import { getRedisClient, createRedisClient, getProbeRedisClient } from './streams/redis.client.js'
import { RedisEventBus, BudgetCircuitBreaker, ProviderCircuitBreaker, Bulkhead } from '@xzawed/agent-streams'
import { TaskGraphRepo } from './db/task-graph.repo.js'
import { DispatchStore } from './db/dispatch.repo.js'
import { LeaseStore } from './db/lease.repo.js'
import { OracleRepo } from './db/oracle.repo.js'
import { DecisionRepo } from './db/decision.repo.js'
import { AdvisoryRepo } from './db/advisory.repo.js'
import { ReleaseGateRepo } from './db/release-gate.repo.js'
import { VerificationFailureRepo } from './db/verification-failure.repo.js'
import { WpOutputRepo } from './db/wp-output.repo.js'
import { resolveLeaseVisibilityMs } from './streams/lease-visibility.js'
import { startupWarnings } from './startup-warnings.js'
import { oracleRoute } from './api/oracle.route.js'
import { decisionRoute } from './api/decision.route.js'
import { riskRoute } from './api/risk.route.js'
import { createSupervisor, shouldWireSupervisor, shouldWireDecisionRoute, type Supervisor } from './streams/supervisor.js'
import { ModeController, shouldEnforceDegraded } from './streams/mode-controller.js'
import type { ProduceDeps } from './decompose/producer.js'
import type { RiskClassifyDeps } from './decompose/risk-producer.js'
import { RiskClassificationRepo } from './db/risk-classification.repo.js'

/**
 * Fastify 인스턴스 옵션.
 *
 * 두 값 모두 이전엔 여기 리터럴로 박혀 있었고 둘 다 틀린 방향이었다.
 *
 * - `logger: config.MODE === 'local'` — **프로덕션에서만 로그가 꺼졌다.** 프로덕션 src 의
 *   `app.log.*` 호출부 65곳(2파일)이 no-op 이 되고, 그중 `setErrorHandler` 의 `app.log.error` 도
 *   포함이라 500 이 흔적 없이 사라졌다. 헤드리스 서비스라 양쪽 모드 모두 켠다.
 * - `trustProxy: true` — 프록시 뒤가 아니면 `X-Forwarded-For` 는 클라이언트가 임의로 쓰는
 *   값이다. Manager 는 오늘 rate limit 도 IP 기반 로직도 없어 악용 경로가 아직 없지만,
 *   그래서 더더욱 하드코딩으로 켜 둘 이유가 없다. `TRUST_PROXY` 로 명시한다.
 *
 * 옵션 계산을 떼어 두면 배선 없이 검사할 수 있다 — `__tests__/server-options.test.ts`.
 *
 * **이 주석은 오래 "`buildServer` 는 DB·Redis·Anthropic 배선을 통째로 끌고 와 테스트가 부르지
 * 못한다"고 적고 있었고, 실측하니 거짓이었다.** 셋 다 지연 연결이라 `DATABASE_URL` 없이 죽은
 * Redis 포트를 줘도 기동한다 — `__tests__/server-wiring.test.ts` 가 그렇게 부른다. 그 거짓
 * 전제가 배선 판정을 아무도 보지 않는 자리로 밀어 넣었다(실측 라인 1/236 · 분기 0/396).
 * 옵션 추출은 여전히 옳지만 **이유는 "부를 수 없어서"가 아니라 "순수 함수가 더 촘촘해서"** 다.
 */
export function makeServerOptions(config: Config): { logger: boolean; trustProxy: boolean } {
  return { logger: true, trustProxy: config.TRUST_PROXY }
}
export async function buildServer(
  config: Config,
): Promise<{
  app: ReturnType<typeof Fastify>
  /** 기존 호출자 호환용 조합자. 종료 경로는 stopIntake / closeResources 를 따로 쓴다. */
  closeAll: () => Promise<void>
  /** 새 작업 유입 차단(동기). HTTP 드레인 **앞**에 온다. */
  stopIntake: () => void
  /** registry → DB 풀. HTTP 드레인 **뒤**에 온다 — 이것이 D6 교정이다. */
  closeResources: () => Promise<void>
}> {
  const app = Fastify(makeServerOptions(config))

  // jscpd:ignore-start
  // replicated-block: fastify-error-envelope
  // Orchestrator의 같은 블록과 바이트 동일해야 한다. 사유와 강제 방법: scripts/check-replicated-blocks.js
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

  // §13 벌크헤드: 전역/에이전트별 캡 중 하나라도 >0이면 가동. 7개 에이전트 RedisAgentHandler에 공유 주입 —
  // 에이전트 종류별 동시 RPC를 캡·초과 시 큐잉(백프레셔·드롭 없음). off(둘 다 0)면 미주입(직접 실행·회귀 0).
  const bulkhead =
    config.MANAGER_BULKHEAD_GLOBAL > 0 || config.MANAGER_BULKHEAD_PER_AGENT > 0
      ? new Bulkhead({ globalLimit: config.MANAGER_BULKHEAD_GLOBAL, perKeyLimit: config.MANAGER_BULKHEAD_PER_AGENT })
      : undefined
  if (bulkhead) {
    app.log.info(
      `[bulkhead] §13 가동 — global=${config.MANAGER_BULKHEAD_GLOBAL || '∞'} perAgent=${config.MANAGER_BULKHEAD_PER_AGENT || '∞'}`,
    )
  }

  const registry = new ToolRegistry()
  registry.register(createPlanTaskHandler(config.REDIS_URL, bulkhead))
  registry.register(createDevelopCodeHandler(config.REDIS_URL, bulkhead))
  registry.register(createDesignUiHandler(config.REDIS_URL, bulkhead))
  registry.register(createRunTestsHandler(config.REDIS_URL, bulkhead))
  registry.register(createBuildProjectHandler(config.REDIS_URL, bulkhead))
  registry.register(createWatchChangesHandler(config.REDIS_URL, bulkhead))
  registry.register(createSecurityAuditHandler(config.REDIS_URL, bulkhead))
  if (config.GITHUB_TOKEN) {
    registry.register(createGithubOpsHandler(config.GITHUB_TOKEN))
  } else {
    app.log.warn(
      'GITHUB_TOKEN이 설정되지 않았습니다. GitHub 관련 작업(repo 생성, 코드 push, PR 생성 등)을 요청하면 "Unknown tool: github_ops" 오류가 발생합니다. .env 파일에 GITHUB_TOKEN을 추가하세요.',
    )
  }
  // ORCHESTRATOR_URL 조건 제거: Redis URL만 필요
  registry.register(createRegisterProjectHandler(config.REDIS_URL))
  registry.register(createSwitchProjectHandler(config.REDIS_URL))

  // §13 budget 서킷브레이커: 워크플로/일 비용 상한 중 하나라도 >0이면 가동. 트립 시 stop(러너가 throw→error 발행)+
  // alert(app.log.warn). 인메모리(재시작 시 일 카운터 소실·per-workflow는 정확). 미설정이면 미주입(회귀 0).
  const budgetEnabled = config.MANAGER_BUDGET_PER_WORKFLOW_USD > 0 || config.MANAGER_BUDGET_DAILY_USD > 0
  const budget: BudgetRunnerDeps | undefined = budgetEnabled
    ? {
        breaker: new BudgetCircuitBreaker({
          perWorkflowUsd: config.MANAGER_BUDGET_PER_WORKFLOW_USD,
          dailyUsd: config.MANAGER_BUDGET_DAILY_USD,
        }),
        onTrip: (info) =>
          app.log.warn(
            `[budget] 서킷 트립 — workflow=${info.workflowId} workflowUsd=$${info.workflowUsd.toFixed(4)} dailyUsd=$${info.dailyUsd.toFixed(4)} (상한 도달 — 이후 호출 차단)`,
          ),
      }
    : undefined
  if (budgetEnabled) {
    app.log.info(
      `[budget] §13 서킷브레이커 가동 — perWorkflow=$${config.MANAGER_BUDGET_PER_WORKFLOW_USD || '∞'} daily=$${config.MANAGER_BUDGET_DAILY_USD || '∞'}`,
    )
  }
  // §13 provider 서킷브레이커: flag on이면 가동. provider 지속 장애 시 open→cooldown 동안 fail-fast(러너가
  // ProviderCircuitOpenError throw→error 발행)+alert(app.log.warn). off면 미주입(회귀 0). 트립은 P6 강등 신호.
  const providerCircuit: ProviderRunnerDeps | undefined = config.MANAGER_PROVIDER_CIRCUIT
    ? {
        breaker: new ProviderCircuitBreaker({
          failureThreshold: config.MANAGER_PROVIDER_CIRCUIT_THRESHOLD,
          cooldownMs: config.MANAGER_PROVIDER_CIRCUIT_COOLDOWN_MS,
        }),
        onOpen: () =>
          app.log.warn(
            `[provider-circuit] open — provider 지속 장애(연속 ${config.MANAGER_PROVIDER_CIRCUIT_THRESHOLD}회)로 회로 개방, ${config.MANAGER_PROVIDER_CIRCUIT_COOLDOWN_MS}ms 동안 fail-fast(강등 신호)`,
          ),
      }
    : undefined
  if (config.MANAGER_PROVIDER_CIRCUIT) {
    app.log.info(
      `[provider-circuit] §13 서킷브레이커 가동 — threshold=${config.MANAGER_PROVIDER_CIRCUIT_THRESHOLD} cooldown=${config.MANAGER_PROVIDER_CIRCUIT_COOLDOWN_MS}ms`,
    )
  }
  // P5-3b: enforcement 배선 판정(순수·전제 MANAGER_DEGRADED_MODE). supervisor는 아래에서 할당 — onRecover
  // 클로저가 forward 캡처(첫 tick은 start() 이후·≥sweepMs라 할당 보장). enforce off면 onRecover/getMode 미배선.
  const enforceDegraded = shouldEnforceDegraded(config.MANAGER_DEGRADED_ENFORCE, config.MANAGER_DEGRADED_MODE)
  let supervisor: Supervisor | undefined

  // P5-3a 운영 강등 모드 추적기(observe-only): MANAGER_DEGRADED_MODE=true면 provider 서킷/budget 신호를
  // 주기 sweep으로 읽어 NORMAL/DEGRADED/SAFE 모드 전이 시 구조적 로그(M8). getMode() 노출 — enforcement는
  // P5-3b 후속. off면 미생성(회귀 0·budget/providerCircuit 없어도 경고만).
  const modeController = config.MANAGER_DEGRADED_MODE
    ? new ModeController(
        {
          signals: () => ({
            providerCircuitOpen: providerCircuit?.breaker.snapshot().state === 'open',
            budgetDailyTripped: budget?.breaker.dailyTripped() ?? false,
          }),
          stabilityWindowMs: config.MANAGER_MODE_STABILITY_WINDOW_MS,
          onTransition: (from, to, reason) =>
            app.log.warn(`[mode] 운영 모드 전이 ${from}→${to} (${reason})`),
          // P5-3b: SAFE 이탈 시 보류된 디스패치 재개(enforce on일 때만 — supervisor는 forward 캡처).
          ...(enforceDegraded && {
            onRecover: () => {
              void supervisor?.resumeDispatch().catch((err: unknown) => app.log.error({ err }, '[degraded] resume 디스패치 실패'))
            },
          }),
        },
        config.MANAGER_MODE_SWEEP_MS,
      )
    : undefined
  const runner = new ClaudeRunner(client, config.CLAUDE_MODEL, registry, knowledgeRepo, undefined, budget, providerCircuit)
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
  // 하드닝: MANAGER_DECOMPOSE_ENABLED 포함 — decompose 생산자가 아웃박스 경유로 decomposition.emitted/.inconsistent를
  // 적재(pool 있을 때)하므로 relay 미기동 시 그 행이 잔류해 분해가 소비자에 도달하지 않는다.
  // P6: MANAGER_DECISION_ROUTING 포함 — 사람 결정(decision.recorded)이 아웃박스에 적재되므로 relay가
  // 돌지 않으면 그 행이 published_at=NULL로 잔류해 decision 소비자(fix_reverify 재진입)가 신호를 받지 못한다.
  if (
    pool &&
    (config.EVENT_SOURCED_SESSION ||
      config.TASK_MANAGER_ENABLED ||
      config.MANAGER_ORACLE_DOR ||
      config.MANAGER_ORACLE_DRAFT ||
      config.MANAGER_DECOMPOSE_ENABLED ||
      config.MANAGER_WP_ADVISORY ||
      config.MANAGER_DECISION_ROUTING ||
      config.MANAGER_RELEASE_GATE ||
      config.MANAGER_RELEASE_SIGNOFF ||
      config.MANAGER_DECISION_EXPIRY ||
      config.MANAGER_RISK_ROUTING || // P2r-4: risk.approved 아웃박스→소비자 발행 필수
      config.MANAGER_DEGRADED_SIGNOFF || // N2: degraded_dispatch 결정 아웃박스→소비자 발행 필수
      config.MANAGER_ORACLE_DECISION || // C3: oracle_approval 결정 아웃박스→소비자 발행 필수
      config.MANAGER_GOLDEN_SIGNOFF) // Slice 1: golden_diff 결정 아웃박스→소비자 발행 필수
  ) {
    outboxRelay = new OutboxRelay(pool, producer, config.MANAGER_OUTBOX_POLL_MS)
    outboxRelay.start()
  }

  // P3-2: oracleStore는 DOR||DRAFT일 때 한 번만 생성해 Supervisor(consumer upsert·satisfied-set)와
  // oracleRoute(작성·승인·조회)에 공유한다(중복 OracleRepo 제거). DoR 게이트(satisfied-set·oracleConsumer)는
  // createSupervisor가 config.oracleDor로 분리 — DRAFT만 켜면 영속만, DoR off.
  // P4b-2: conformance 채널도 approvedOracleForStory(=OracleRepo)를 필요로 하므로 생성 조건에 WP_CONFORMANCE 추가.
  const oracleStore =
    pool && (config.MANAGER_ORACLE_DOR || config.MANAGER_ORACLE_DRAFT || config.MANAGER_WP_CONFORMANCE || config.MANAGER_WP_IMPACT || config.MANAGER_WP_PROPERTY || config.MANAGER_GOLDEN_SIGNOFF)
      ? new OracleRepo(pool)
      : undefined
  // P6: 결정 영속소(escalation→DecisionRequest 브리프 + 결정 라우팅 getRequest). BRIEF 또는 ROUTING 중
  // 하나라도 켜지면(+pool) 생성 — 라우팅 소비자도 같은 DecisionRepo의 getRequest를 사용한다(회귀 0: 둘 다 off면 undefined).
  const decisionStore =
    pool && (config.MANAGER_DECISION_BRIEF || config.MANAGER_DECISION_ROUTING || config.MANAGER_DECISION_EXPIRY || config.MANAGER_RISK_DECISION || config.MANAGER_DEGRADED_SIGNOFF || config.MANAGER_ORACLE_DECISION || config.MANAGER_GOLDEN_SIGNOFF) ? new DecisionRepo(pool) : undefined
  // P4: advisory 채널 영속소(검증 통과 뒤 optimization 제안). MANAGER_WP_ADVISORY + pool 시만 생성(회귀 0).
  const advisoryStore = pool && config.MANAGER_WP_ADVISORY ? new AdvisoryRepo(pool) : undefined
  // P5-1: 릴리스 게이트 증거/결과 영속소(recordEvidence·recordGate·evidenceForWorkflow). MANAGER_RELEASE_GATE + pool 시만 생성(회귀 0).
  const releaseStore = pool && config.MANAGER_RELEASE_GATE ? new ReleaseGateRepo(pool) : undefined
  // S7.1: 검증 실패 사유 투영. **플래그가 없다** — 이미 나던 실패를 사람이 읽는 브리프로 잇는 것이라
  // 켜고 끌 새 동작이 아니다. pool 이 없으면(미구성) 미주입이고 사유는 이전처럼 스트림에만 남는다.
  const failureStore = pool ? new VerificationFailureRepo(pool) : undefined
  // S6.3: WP 실제 산출물 투영(결함 F7). 플래그 없음 — 이미 나던 산출물을 후행 입력으로 잇는 것이다.
  const outputStore = pool ? new WpOutputRepo(pool) : undefined
  // P2r-3/P2r-4 공유 repo — Supervisor에 riskStore 주입(C5) 위해 createSupervisor 전 선언(상세 배선은 아래 riskClassify 블록).
  // D5: MANAGER_MODEL_ROUTING도 riskStore(approvedForWorkflow) 소비 — 세 조건 중 하나면 생성.
  const riskStore = pool && (config.MANAGER_RISK_CLASSIFY || config.MANAGER_RISK_ROUTING || config.MANAGER_MODEL_ROUTING) ? new RiskClassificationRepo(pool) : undefined

  // P5-2b: 릴리스 게이트 통과/사인오프를 deploy_project 하드 전제로. pool 가드로 truthy 보장.
  const deployGate =
    pool && config.MANAGER_DEPLOY_GATE && config.MANAGER_RELEASE_GATE
      ? new ReleaseDeployGate(
          releaseStore ?? new ReleaseGateRepo(pool),
          decisionStore ?? new DecisionRepo(pool),
          config.MANAGER_DEPLOY_GATE_STRICT, // G6: strict면 fail-open 분기를 차단으로
        )
      : undefined
  if (config.GITHUB_TOKEN) {
    registry.register(createDeployProjectHandler(config.GITHUB_TOKEN, config.REDIS_URL, deployGate))
  }

  // G8: lease 가시성 auto-tune — 활성 검증 채널이 요구하는 가시성 바닥값을 계산해 configured가 낮으면 자동 상향한다
  // (올리기만·낮추진 않음). verify/security=360s(120s×3), heavy(conformance/impact/property/mutation)=600s.
  // 이전에는 채널별로 "가시성이 낮다"는 경고 4개를 냈으나(운영자가 수동 교정해야 함), 프리미엄 목표상 자동 교정한다.
  const leaseVisibility = resolveLeaseVisibilityMs({
    configuredMs: config.MANAGER_LEASE_VISIBILITY_MS,
    wpVerify: config.MANAGER_WP_VERIFY,
    wpConformance: config.MANAGER_WP_CONFORMANCE,
    wpImpact: config.MANAGER_WP_IMPACT,
    wpProperty: config.MANAGER_WP_PROPERTY,
    wpMutation: config.MANAGER_WP_MUTATION,
    wpSecurity: config.MANAGER_WP_SECURITY,
  })
  if (leaseVisibility.bumped) {
    app.log.warn(
      `[lease] MANAGER_LEASE_VISIBILITY_MS=${config.MANAGER_LEASE_VISIBILITY_MS}ms 가 활성 검증 채널(${leaseVisibility.drivers.join(',')}) 요구 바닥값 ${leaseVisibility.floorMs}ms 보다 낮아 ${leaseVisibility.effectiveMs}ms 로 자동 상향합니다(false reclaim 방지). 명시 상향하려면 MANAGER_LEASE_VISIBILITY_MS 를 조정하세요.`,
    )
  }

  // 기동 경고는 startup-warnings.ts 의 순수 함수 하나가 판정한다. **여기서 조건을 다시 쓰지 않는다** —
  // 이 파일은 buildServer 배선을 통째로 끌고 와 테스트가 부르지 못하고(라인 1/236·분기 0/396), 그래서
  // 인라인 경고는 한 번도 검증된 적이 없었다. 실제로 advisory 경고가 사실과 반대였다(startup-warnings.ts).
  for (const msg of startupWarnings({
    taskManager: config.TASK_MANAGER_ENABLED, taskWorker: config.MANAGER_TASK_WORKER,
    decompose: config.MANAGER_DECOMPOSE_ENABLED,
    degradedMode: config.MANAGER_DEGRADED_MODE, degradedEnforce: config.MANAGER_DEGRADED_ENFORCE,
    degradedSignoff: config.MANAGER_DEGRADED_SIGNOFF,
    deployGate: config.MANAGER_DEPLOY_GATE, releaseGate: config.MANAGER_RELEASE_GATE,
    releaseSignoff: config.MANAGER_RELEASE_SIGNOFF,
    oracleDraft: config.MANAGER_ORACLE_DRAFT, oracleInvariants: config.MANAGER_ORACLE_INVARIANTS,
    oracleDecision: config.MANAGER_ORACLE_DECISION, goldenSignoff: config.MANAGER_GOLDEN_SIGNOFF,
    wpVerify: config.MANAGER_WP_VERIFY, wpConformance: config.MANAGER_WP_CONFORMANCE,
    wpImpact: config.MANAGER_WP_IMPACT, wpProperty: config.MANAGER_WP_PROPERTY,
    wpMutation: config.MANAGER_WP_MUTATION, wpSecurity: config.MANAGER_WP_SECURITY,
    wpAdvisory: config.MANAGER_WP_ADVISORY,
    decisionBrief: config.MANAGER_DECISION_BRIEF, decisionRouting: config.MANAGER_DECISION_ROUTING,
    decisionExpiry: config.MANAGER_DECISION_EXPIRY,
    riskClassify: config.MANAGER_RISK_CLASSIFY, riskRouting: config.MANAGER_RISK_ROUTING,
    riskDecision: config.MANAGER_RISK_DECISION, modelRouting: config.MANAGER_MODEL_ROUTING,
    // 파생 상태는 플래그로 재계산하지 않고 **실제로 만들어진 것**을 넘긴다.
    hasPool: pool !== undefined, hasOracleStore: oracleStore !== undefined,
    hasBudget: budget !== undefined, hasProviderCircuit: providerCircuit !== undefined,
    mutationMinRisk: config.MANAGER_MUTATION_MIN_RISK, mutationTheta: config.MANAGER_MUTATION_THETA,
    thetaLow: config.MANAGER_MUTATION_THETA_LOW, thetaMedium: config.MANAGER_MUTATION_THETA_MEDIUM,
    thetaHigh: config.MANAGER_MUTATION_THETA_HIGH,
  })) app.log.warn(msg)

  // Task Manager Supervisor 배선(P1d-7): flag on + pool이면 decomposition 소비→디스패치·lease sweep·
  // completion 소비→재디스패치를 가동. 생산자(P2) 미도착이라 빈 스트림 구독(동작 준비). flag off면 미배선.
  const supervisorDecision = shouldWireSupervisor(config.TASK_MANAGER_ENABLED, pool !== undefined)
  if (supervisorDecision === 'wire' && pool) {
    const bus = new RedisEventBus(createRedisClient(config.REDIS_URL))
    // P4-1: 실행 워커가 owningRole로 자율 호출할 에이전트 핸들러(tool명→handler). 답변 가능 5종(watcher 제외).
    const WORKER_TOOL_NAMES = ['develop_code', 'design_ui', 'run_tests', 'build_project', 'security_audit'] as const
    const workerHandlers: Record<string, { execute(input: unknown, sessionId: string): Promise<unknown> }> = {}
    for (const t of WORKER_TOOL_NAMES) {
      const h = registry.get(t)
      if (h) workerHandlers[t] = h
    }
    supervisor = createSupervisor(
      () => createRedisClient(config.REDIS_URL),
      {
        repo: new TaskGraphRepo(pool),
        dispatchStore: new DispatchStore(pool),
        leaseStore: new LeaseStore(pool),
        publish: (stream, message) => bus.publish(stream, message),
        // P5-3b: enforce 시 운영 강등 모드 조회 주입 → handleDispatch가 SAFE면 보류·held-set 적재.
        ...(enforceDegraded && modeController && { getMode: () => modeController.getMode() }),
        // DOR||DRAFT 공유 oracleStore. createSupervisor가 config.oracleDor로 DoR 게이트(satisfied-set·
        // oracleConsumer) 활성 여부를 분리 — DRAFT만 켜면 decompositionConsumer가 upsertDraft만 수행.
        ...(oracleStore && { oracleStore }),
        // P4-1: MANAGER_TASK_WORKER on이면 워커 핸들러 맵 주입 → createSupervisor가 워커 배선. off면 미주입(회귀 0).
        ...(config.MANAGER_TASK_WORKER && { handlers: workerHandlers }),
        // P6: 결함 브리프 영속소(=MANAGER_DECISION_BRIEF). createSupervisor가 config.decisionBrief로 onEscalated 배선.
        ...(decisionStore && { decisionStore }),
        // P4: advisory 영속소 + LLM seam(=MANAGER_WP_ADVISORY). buildWorkerConsumerDeps가 advisoryStore 동반 시만 활성.
        ...(advisoryStore && { advisoryStore }),
        ...(config.MANAGER_WP_ADVISORY && { claude: client, model: config.CLAUDE_MODEL, timeoutMs: config.CLAUDE_TIMEOUT_MS }),
        // G1: §13 서킷(advisory 경로 보호·러너·decompose와 동일 인스턴스 공유).
        ...(budget && { budget: budget.breaker }),
        ...(providerCircuit && { provider: providerCircuit.breaker }),
        isProviderFailure,
        // P5-1: 릴리스 게이트 증거/결과 영속소(ReleaseGateRepo). releaseGate flag + 주입 시 게이트 평가.
        ...(releaseStore && { releaseStore }),
        // S7.1: 검증 실패 사유 투영 — 워커가 쓰고 에스컬레이션 브리프가 읽는다(결함 F5).
        ...(failureStore && { failureStore }),
        // S6.3: 선행 WP 산출물 → 후행 WP 입력(결함 F7). security static 이 실제로 스캔하게 된다.
        ...(outputStore && { outputStore }),
        // S7.2: spec_fix → 재분해(결함 F6). **접근자로 넘긴다** — `decompose` 조립이 이 호출보다
        // 뒤라 값으로 주면 undefined 다. 클로저는 런타임(사람이 버튼을 누른 시점)에 평가된다.
        ...(config.MANAGER_DECOMPOSE_ENABLED && { decomposeDeps: () => decompose }),
        // C5: DecisionRecordedConsumer에 riskStore 주입 → approve 분기 활성. MANAGER_RISK_DECISION 게이트로
        //   생산자(emit) 측과 대칭 — flag off면 소비자가 riskStore를 받지 않아 'off→바이트 동일' 불변식이 문자 그대로 성립.
        // D5: MANAGER_MODEL_ROUTING도 riskStore(approvedForWorkflow) 소비 — 둘 중 하나면 주입.
        ...((config.MANAGER_RISK_DECISION || config.MANAGER_MODEL_ROUTING) && riskStore && { riskStore }),
        // C7 arm1: inconsistent 시 에러를 orchestrator에 노출(manager:to-orchestrator:{wf}). producer로 구성.
        notifyUser: (wf: string, content: string) =>
          producer
            .publish({ sessionId: wf, messageId: crypto.randomUUID(), timestamp: Date.now(), type: 'error', payload: { agentId: 'manager', content } })
            .then(() => undefined),
      },
      {
        sweepMs: config.MANAGER_LEASE_SWEEP_MS,
        // G8: auto-tune된 가시성(활성 채널 바닥값과 configured 중 큰 값). config 값보다 낮아지지 않음.
        visibilityMs: leaseVisibility.effectiveMs,
        maxAttempts: config.MANAGER_LEASE_MAX_ATTEMPTS,
        oracleDor: config.MANAGER_ORACLE_DOR,
        // C3: 오라클 승인 결정(=MANAGER_ORACLE_DECISION). off면 oracle_approval 미발행·미소비(회귀 0). oracleStore+decisionStore 동반 시만 활성.
        oracleDecision: config.MANAGER_ORACLE_DECISION,
        // Slice 1: golden freeze 사인오프(=MANAGER_GOLDEN_SIGNOFF). off면 golden_diff 미발행·미소비(회귀 0). oracleStore+decisionStore 동반 시만 활성.
        goldenSignoff: config.MANAGER_GOLDEN_SIGNOFF,
        // P4-1: 워커 활성(=MANAGER_TASK_WORKER). off면 handlers 미주입·shouldWireWorker=false → 워커 미배선(회귀 0).
        taskWorker: config.MANAGER_TASK_WORKER,
        // P4b-1: 워커 검증 게이트(=MANAGER_WP_VERIFY). off면 워커 동작 P4a-2와 동일(회귀 0).
        wpVerify: config.MANAGER_WP_VERIFY,
        // P4b-2: conformance 채널(=MANAGER_WP_CONFORMANCE). off면 P4b-1 검증과 바이트 동일(회귀 0).
        // buildWorkerConsumerDeps가 oracleStore 동반 시에만 conformanceEnabled=true로 게이트(검증 우회 무음 방지).
        wpConformance: config.MANAGER_WP_CONFORMANCE,
        // P6: 결함 브리프(=MANAGER_DECISION_BRIEF). off면 escalation 시 브리프 미생성(회귀 0). decisionStore 동반 시만 배선.
        decisionBrief: config.MANAGER_DECISION_BRIEF,
        // P6: 결정 라우팅(=MANAGER_DECISION_ROUTING). off면 decision 소비자 미배선(회귀 0). decisionStore 동반 시만 배선.
        decisionRouting: config.MANAGER_DECISION_ROUTING,
        // P4: impact golden-differential 채널(=MANAGER_WP_IMPACT). off면 conformance까지와 동일(회귀 0). oracleStore 동반 시만 활성.
        wpImpact: config.MANAGER_WP_IMPACT,
        // P4: property/invariants 채널(=MANAGER_WP_PROPERTY). off면 impact까지와 동일(회귀 0). oracleStore 동반 시만 활성.
        wpProperty: config.MANAGER_WP_PROPERTY,
        // P4 mutation θ_risk 채널(=MANAGER_WP_MUTATION). off면 property까지와 동일(회귀 0). oracle 미소비.
        wpMutation: config.MANAGER_WP_MUTATION,
        // S5.4: 등급별 θ 를 기동 시 한 번 완전한 맵으로 해석한다. 미설정 등급은 공통 θ 를
        //       그대로 받으므로 아무것도 설정하지 않으면 동작이 변하지 않는다(회귀 0).
        mutationThetaByRisk: resolveThetaByRisk(config.MANAGER_MUTATION_THETA, {
          LOW: config.MANAGER_MUTATION_THETA_LOW,
          MEDIUM: config.MANAGER_MUTATION_THETA_MEDIUM,
          HIGH: config.MANAGER_MUTATION_THETA_HIGH,
        }),
        mutationMinRisk: config.MANAGER_MUTATION_MIN_RISK,
        mutationMaxMutants: config.MANAGER_MUTATION_MAX_MUTANTS,
        // P4 4d security 채널(=MANAGER_WP_SECURITY). off면 mutation까지와 동일(회귀 0). oracle 미소비.
        wpSecurity: config.MANAGER_WP_SECURITY,
        securityMinSeverity: config.MANAGER_WP_SECURITY_MIN_SEVERITY,
        // P4: advisory 채널(=MANAGER_WP_ADVISORY). off면 워커 동작 P4b와 동일(회귀 0). advisoryStore 동반 시만 활성.
        wpAdvisory: config.MANAGER_WP_ADVISORY,
        // P5-1: 릴리스 게이트(=MANAGER_RELEASE_GATE). off면 완료 흐름과 동일(회귀 0). releaseStore 동반 시만 활성.
        releaseGate: config.MANAGER_RELEASE_GATE,
        // P5-2a: gate.blocked→사인오프(=MANAGER_RELEASE_SIGNOFF). off면 gate.blocked 무시·회귀 0.
        releaseSignoff: config.MANAGER_RELEASE_SIGNOFF,
        // N2: DEGRADED HIGH-risk 디스패치 사인오프(=MANAGER_DEGRADED_SIGNOFF). off면 회귀 0. decisionStore+getMode(enforce) 동반 시 활성.
        degradedSignoff: config.MANAGER_DEGRADED_SIGNOFF,
        // B1: 결정 만료 sweep(=MANAGER_DECISION_EXPIRY). off면 sweep 미배선·expiresAt 미주입(회귀 0). decisionStore 동반 시만 배선.
        decisionExpiry: config.MANAGER_DECISION_EXPIRY,
        decisionSweepMs: config.MANAGER_DECISION_SWEEP_MS,
        decisionTtlMs: config.MANAGER_DECISION_TTL_HOURS * 3_600_000, // 시간→ms
        // B1: 재에스컬레이션 상한(=MANAGER_DECISION_REESCALATE_MAX). decisionExpiry 소비자가 소비.
        decisionReescalateMax: config.MANAGER_DECISION_REESCALATE_MAX,
        // P2r-4: risk.approved 소비(→wp.risk write-back) 활성(=MANAGER_RISK_ROUTING). off면 riskConsumer 미배선(회귀 0).
        riskRouting: config.MANAGER_RISK_ROUTING,
        // D5: 모델 라우팅(=MANAGER_MODEL_ROUTING). off면 worker가 CLAUDE_MODEL 폴백(회귀 0). riskStore+ids 동반 필요.
        modelRouting: config.MANAGER_MODEL_ROUTING,
        modelOpus: config.MANAGER_MODEL_OPUS,
        modelSonnet: config.MANAGER_MODEL_SONNET,
      },
    )
    supervisor.start()
    app.log.info('[task-manager] Supervisor 가동(decomposition→dispatch · lease sweep · completion→re-dispatch)')
  } else if (supervisorDecision === 'warn') {
    app.log.warn('TASK_MANAGER_ENABLED=true 이지만 DATABASE_URL이 없어 Supervisor를 배선하지 않습니다.')
  }
  // P5-3b: modeController는 supervisor 할당 이후 가동(onRecover가 supervisor를 안전 참조). observe-only(enforce off)도
  // 동일 — start는 supervisor 유무와 무관(MANAGER_DEGRADED_MODE만 전제). closeAll에서 stop(기존).
  modeController?.start()

  // P2-3a 다단계 분해 생산자(flag on): decompose_request → 4단계 LLM 분해 → decomposition.emitted 발행.
  const decompose: ProduceDeps | undefined = config.MANAGER_DECOMPOSE_ENABLED
    ? {
        claude: client,
        model: config.CLAUDE_MODEL,
        // 하드닝: pool 있으면 트랜잭셔널 아웃박스 경유(at-least-once·truth-source 정합·M5/M7) — OutboxRelay가 발행.
        // pool 없으면 raw 발행으로 우아한 강등(내구성 없음·아래 경고). producer 코드는 무수정(DecomposePublish 동일).
        publish: pool
          ? createOutboxPublish(pool)
          : (stream, message) => producer.publishRaw(stream, message),
        timeoutMs: config.CLAUDE_TIMEOUT_MS,
        repairMax: config.MANAGER_DECOMPOSE_REPAIR_MAX,
        log: (msg, data) => app.log.info(data ?? {}, msg),
        // P3-2: ok 경로에서 draft 스테이지 실행 → oracleDrafts emit(off면 []·회귀 0).
        draftOracles: config.MANAGER_ORACLE_DRAFT,
        // F5: invariant 초안 생성(off면 oracleDrafts[].invariants []·회귀 0). 전제 MANAGER_ORACLE_DRAFT.
        draftInvariants: config.MANAGER_ORACLE_INVARIANTS,
        // G1: §13 서킷(러너·risk와 동일 인스턴스 공유). 미주입이면 무보호(회귀 0).
        ...(budget && { budget: budget.breaker }),
        ...(providerCircuit && { provider: providerCircuit.breaker }),
        isProviderFailure,
      }
    : undefined
  // 경고는 위 startupWarnings 가 낸다(아웃박스 미경유·C1 미노출). 여기는 배선 사실만 알린다.
  if (config.MANAGER_DECOMPOSE_ENABLED) {
    app.log.info('[decompose] MANAGER_DECOMPOSE_ENABLED — decompose_request 생산자 배선')
  }

  // P2r-3 생산자(MANAGER_RISK_CLASSIFY) + P2r-4 승인 라우트(MANAGER_RISK_ROUTING) 공유 repo — 위에서 선언됨.
  const riskClassify: RiskClassifyDeps | undefined = riskStore
    ? {
        claude: client,
        model: config.CLAUDE_MODEL,
        timeoutMs: config.CLAUDE_TIMEOUT_MS,
        repo: riskStore,
        ...(budget && { budget: budget.breaker }),
        ...(providerCircuit && { provider: providerCircuit.breaker }),
        isProviderFailure,
        log: (msg, data) => app.log.info(data ?? {}, msg),
        // C5: humanGate.required 시 DecisionRequest 발행용(flag+decisionStore 동반 시만 주입).
        ...(config.MANAGER_RISK_DECISION && decisionStore && { decisionStore }),
      }
    : undefined
  // 전제 미충족 경고(risk·oracle·golden)는 위 startupWarnings 가 낸다. 여기는 배선 성공만 알린다.
  if (config.MANAGER_RISK_CLASSIFY && pool && config.MANAGER_DECOMPOSE_ENABLED) {
    app.log.info('[risk] P2r-3 리스크 분류 생산자 배선(pending·N6 미승인)')
  }
  if (config.MANAGER_RISK_ROUTING && pool && config.TASK_MANAGER_ENABLED) {
    app.log.info('[risk] P2r-4 리스크 승인 라우팅 배선(risk.approved→wp.risk write-back)')
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

  await app.register(healthRoute, {
    // S4.3: probe 전용 연결. 공유 클라이언트는 블로킹 소비(`XREADGROUP BLOCK 2000`)가 점유해
    //       ping 이 readiness 예산(1000ms)을 항상 넘긴다 — 첫 세션 이후 영구 503 이었다.
    redis: () => getProbeRedisClient(config.REDIS_URL),
    // sessionGateway 는 아래에서 생성된다. 접근자라 요청 시점에 평가된다.
    gatewayRunning: () => sessionGateway.isRunning(),
    pool: () => getPool(),
  })
  // S3.3: `/metrics` — DLQ 적재량·PEL 깊이(결함 O1). 전 서비스가 한 Redis 를 공유하므로
  // 여기 한 곳에서 훑으면 시스템 전체가 보인다(서비스별 배선 복제 없음).
  // `healthRoute` 와 같은 이유로 접근자다 — 등록이 Redis 배선보다 앞설 수 있다.
  await app.register(metricsRoute, { redis: () => getProbeRedisClient(config.REDIS_URL) })
  // 관측성: knowledge/oracle/risk 라우트는 admin/decision(authHook 없으면 미등록·fail-closed)과 달리
  // 의도적으로 authHook 없이도 등록된다(oracleRoute·riskRoute 코멘트 참조 — oracle-tier·로컬/데모 개방).
  // 다만 SERVICE_JWT_SECRET 미설정 시 이들의 쓰기(PATCH/DELETE·approve)가 무인증 노출되므로,
  // 사일런트하지 않도록 기동 시 경고한다(동작은 불변 — 로컬 개발 보존, 프로덕션 운영자 경보).
  if (!authHook) {
    app.log.warn('SERVICE_JWT_SECRET 미설정 — knowledge/oracle/risk mutation 라우트가 무인증으로 노출됩니다(의도적 oracle-tier·로컬/개발 전용). 프로덕션은 AUTH=jwt + SERVICE_JWT_SECRET(32자+) 필수.')
  }
  // 쓰기 경로(PATCH/DELETE)에만 서비스 토큰 요구(authHook). GET은 개방 유지.
  await app.register(knowledgeRoute, { ...(knowledgeRepo && { knowledgeRepo }), ...(authHook && { authHook }) })
  // P3-1/P3-2 Oracle 라우트(DOR||DRAFT·pool 시 공유 oracleStore): 작성·승인·조회. 쓰기는 authHook 설정 시 보호.
  // DRAFT-only에서도 API approve가 가능해야 drafted→human_approved 전이 + oracle.approved 아웃박스가 닫힌다.
  await app.register(oracleRoute, {
    ...(oracleStore && { oracleRepo: oracleStore }),
    ...(authHook && { authHook }),
  })
  // P2r-4: 리스크 분류 승인 라우트. 쓰기는 authHook 설정 시 보호. repo 없으면 503(graceful).
  // ⚠️ 의도적 oracle-tier 포스처(decision/admin처럼 미인증 시 미등록하지 않고 oracleRoute처럼 항상 등록):
  //   승인은 pending 분류를 이미 산출된 risk로 확정할 뿐이라 write-back은 검증 강도를 '올리기만'(게이트 미저하)·
  //   사람 신원 비부인은 상위(Orchestrator C5/decidedBy)에서 확립. 직접 형제 oracleRoute와 동일 tier 유지.
  await app.register(riskRoute, { ...(riskStore && { riskRepo: riskStore }), ...(authHook && { authHook }) })
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
    ...(riskClassify && { riskClassify }),
    ...(config.MANAGER_DECISION_ROUTING && decisionStore && { decisionStore }),
  })
  // 운영 라우트: DLQ 재처리(redriveDlq). 격리된 poison 메시지를 원 스트림으로 되돌린다.
  // 부수효과(원 스트림 재발행→자율 에이전트 실행 트리거)가 있는 권한 엔드포인트라 인증이 **필수**다 —
  // authHook(SERVICE_JWT_SECRET)이 없으면 open admin endpoint를 만들지 않기 위해 라우트를 **등록하지 않는다**.
  if (authHook) {
    await app.register(adminRoute, { redisUrl: config.REDIS_URL, authHook })
  } else {
    app.log.warn('SERVICE_JWT_SECRET 미설정 — DLQ 재처리 운영 라우트(/api/admin/dlq/redrive)를 등록하지 않습니다(인증 필수).')
  }
  // P6: 결정 제출은 escalated WP 재진입(lease 재오픈→dispatch_signal)을 트리거하는 권한 쓰기 — admin 패턴과 동일하게
  // authHook(서비스 JWT) 없으면 라우트를 등록하지 않는다(무인증 권한 엔드포인트 노출 금지·보안 HIGH-3).
  const decisionRouteGate = shouldWireDecisionRoute(config.MANAGER_DECISION_ROUTING, pool !== undefined, authHook !== undefined)
  if (decisionRouteGate === 'wire') {
    // exactOptionalPropertyTypes: authHook도 안전 스프레드(키 생략). gate==='wire'는 authHook!==undefined일 때만이라 동작 불변.
    await app.register(decisionRoute, { ...(decisionStore && { decisionRepo: decisionStore }), ...(authHook && { authHook }) })
  } else if (decisionRouteGate === 'warn') {
    app.log.warn('MANAGER_DECISION_ROUTING=true 이지만 authHook(AUTH=jwt·SERVICE_JWT_SECRET)이 없어 결정 제출 라우트를 등록하지 않습니다(무인증 권한 엔드포인트 금지).')
  }

  const startManagedSession = makeSessionStarter({
    redisUrl: config.REDIS_URL, runner, producer, sessionStore, activeConsumers,
    registry,
    watcherEventConsumer,
    ...(decompose && { decompose }),
    ...(riskClassify && { riskClassify }),
    ...(config.MANAGER_DECISION_ROUTING && decisionStore && { decisionStore }),
    log: { error: (obj, msg) => app.log.error(obj, msg) },
  })

  const sessionGateway = new SessionGatewayConsumer(config.REDIS_URL, startManagedSession)
  void sessionGateway.start().catch((err: unknown) => {
    app.log.error({ err }, 'SessionGatewayConsumer crashed')
  })

  // 종료는 두 국면이다. 인테이크 차단(동기)은 HTTP 드레인 **앞**, 자원 해제는 드레인 **뒤**.
  // 붙여 두면 아직 처리 중인 요청이 이미 end() 된 pg 풀을 만나
  // 'Cannot use a pool after calling end on the pool' 로 실패한다 — 그게 D6 다.
  const stopIntake = () => {
    modeController?.stop()
    supervisor?.stop()
    outboxRelay?.stop()
    sessionGateway.stop()
    watcherEventConsumer.stop()
    for (const c of activeConsumers.values()) c.stop()
  }

  const closeResources = async () => {
    await registry.closeAll()
    await closePool()
  }

  // 기존 의미론(둘을 연달아)을 그대로 보존한 조합자. 종료 경로는 이것을 쓰지 않는다.
  const closeAll = async () => {
    stopIntake()
    await closeResources()
  }

  return { app, closeAll, stopIntake, closeResources }
}
