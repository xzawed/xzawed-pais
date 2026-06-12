import type { Redis } from 'ioredis'
import { z, type ZodType } from 'zod'
import { BaseConsumer, EventEnvelopeSchema } from '@xzawed/agent-streams'
import { DecompositionConsumer, type Publish, type DecompositionDeps } from './decomposition-consumer.js'
import { handleDispatch, type DispatchDeps, type OracleStore } from './dispatch.js'
import { buildOracleApprovedHandler, OracleApprovedSchema, type OracleApprovedMessage } from './oracle-consumer.js'
import { handleCompletion } from './completion.js'
import { LeaseSweeper } from './lease-sweeper.js'
import { makeEscalationBrief, type DecisionBriefStore } from './decision-brief.js'
import { WorkerConsumer, shouldWireWorker, type AgentExecutor, type WorkerDeps } from './worker.js'
import type { AdvisoryStore } from './advisory.js'
import type { ClaudeLike } from '@xzawed/agent-streams'
import type { ConformanceOracleStore } from './conformance.js'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { DispatchStore } from '../db/dispatch.repo.js'
import type { LeaseStore } from '../db/lease.repo.js'

const COMPLETION_GROUP = 'manager-completion-consumers'
const COMPLETION_PREFIX = 'manager:completions'
const ORACLE_GROUP = 'manager-oracle-consumers'
const ORACLE_PREFIX = 'manager:oracle'
const DEFAULT_CHANNEL = 'main'

/** 워커 완료 신호(생산자=P4-1 실행 워커 worker.ts). workflowId는 봉투, wpId는 payload. */
export const CompletionSignalSchema = z.object({
  envelope: EventEnvelopeSchema,
  type: z.literal('wp.completion'),
  payload: z.object({ wpId: z.string().min(1) }),
})
export type CompletionSignalMessage = z.infer<typeof CompletionSignalSchema>

export interface CompletionHandlerDeps {
  leaseStore: LeaseStore
  dispatch: DispatchDeps
}

/** 완료 신호 소비 핸들러: handleCompletion(lease release·DONE·후행 재디스패치). */
export function buildCompletionHandler(
  deps: CompletionHandlerDeps,
): (msg: CompletionSignalMessage) => Promise<void> {
  return async (msg) => {
    await handleCompletion(msg.envelope.workflowId, msg.payload.wpId, {
      leaseStore: deps.leaseStore,
      dispatch: deps.dispatch,
    })
  }
}

interface ConsumerLike {
  start: (channel: string) => Promise<void>
  stop: () => void
}
interface SweeperLike {
  start: () => void
  stop: () => void
}
export interface SupervisorComponents {
  decompositionConsumer: ConsumerLike
  completionConsumer: ConsumerLike
  leaseSweeper: SweeperLike
  /** P3-1: oracle.approved 소비자(주입 시만 배선·flag off면 미주입). */
  oracleConsumer?: ConsumerLike
  /** P4-1: wp.dispatch_signal 소비자(taskWorker+handlers 주입 시만 배선). */
  workerConsumer?: ConsumerLike
}

/**
 * Task Manager 런타임 생명주기 코디네이터 — decomposition 소비(→영속→디스패치)·completion 소비(→재디스패치)·
 * lease sweep을 함께 start/stop. 컴포넌트는 주입(테스트 용이). 단일 인스턴스 전제.
 */
export class Supervisor {
  constructor(
    private readonly components: SupervisorComponents,
    private readonly channel: string = DEFAULT_CHANNEL,
  ) {}

  start(): void {
    // consumer.start()는 정상 운영 중 resolve되지 않으나, 기동 시점(ensureGroup 등) reject는 .catch로
    // 관측한다(SessionGatewayConsumer 배선 선례 — unhandledRejection 방지).
    this.components.decompositionConsumer.start(this.channel).catch((err: unknown) => {
      console.error('[supervisor] decomposition consumer 시작 실패:', err)
    })
    this.components.completionConsumer.start(this.channel).catch((err: unknown) => {
      console.error('[supervisor] completion consumer 시작 실패:', err)
    })
    this.components.oracleConsumer?.start(this.channel).catch((err: unknown) => {
      console.error('[supervisor] oracle consumer 시작 실패:', err)
    })
    this.components.workerConsumer?.start(this.channel).catch((err: unknown) => {
      console.error('[supervisor] worker consumer 시작 실패:', err)
    })
    this.components.leaseSweeper.start()
  }

  stop(): void {
    this.components.decompositionConsumer.stop()
    this.components.completionConsumer.stop()
    this.components.oracleConsumer?.stop()
    this.components.workerConsumer?.stop()
    this.components.leaseSweeper.stop()
  }
}

/** server.ts Supervisor 배선 게이트 결정(순수·테스트 가능): flag+pool='wire', flag만='warn', 아니면 'skip'. */
export function shouldWireSupervisor(enabled: boolean, hasPool: boolean): 'wire' | 'warn' | 'skip' {
  if (enabled && hasPool) return 'wire'
  if (enabled) return 'warn'
  return 'skip'
}

export interface SupervisorDeps {
  repo: TaskGraphRepo
  dispatchStore: DispatchStore
  leaseStore: LeaseStore
  publish: Publish
  /** P3-1 dispatch satisfied-set(approvedByWorkflow) + P3-2 consumer upsertDraft 둘 다 노출(blocker#2).
   *  DOR||DRAFT일 때 server.ts가 OracleRepo 주입. DRAFT만 켜도 decompositionConsumer가 upsert로 사용. */
  oracleStore?: OracleStore & NonNullable<DecompositionDeps['oracleStore']> & ConformanceOracleStore
  /** P4-1: tool명→에이전트 핸들러(server.ts가 registry.get으로 주입). 주입+taskWorker면 워커 배선. */
  handlers?: Record<string, AgentExecutor>
  /** P6: 결함 브리프 영속소(DecisionRepo 구조). decisionBrief flag + 주입 시 escalation→DecisionRequest. */
  decisionStore?: DecisionBriefStore
  /** P4 advisory 채널 영속소(AdvisoryRepo). advisoryStore + wpAdvisory면 워커가 produceAdvisory 호출. */
  advisoryStore?: AdvisoryStore
  /** P4 advisory 생산자 LLM seam(produceAdvisory용). */
  claude?: ClaudeLike
  model?: string
  timeoutMs?: number
}
export interface SupervisorConfig {
  sweepMs: number
  visibilityMs: number
  maxAttempts: number
  /** P3-2: DoR 게이트(satisfied-set 주입·oracleConsumer) 활성(=MANAGER_ORACLE_DOR).
   *  consumer upsertDraft는 oracleStore 유무로만 동작(DRAFT만 켜도 영속·blocker#1 분리). */
  oracleDor: boolean
  /** P4-1: 실행 워커(WorkerConsumer 배선 + dispatch/reclaim 신호 발행) 활성(=MANAGER_TASK_WORKER). */
  taskWorker: boolean
  /** P4b-1: 워커 검증 게이트(완료 발행 전 fail-closed 실 검증) 활성(=MANAGER_WP_VERIFY, 기본 off). */
  wpVerify?: boolean
  /** P4b-2: conformance 채널(승인 오라클을 실행 테스트로 검증) 활성(=MANAGER_WP_CONFORMANCE). oracleStore 동반 필요. */
  wpConformance?: boolean
  /** P6: 결함 의사결정 브리프(escalation→DecisionRequest) 활성(=MANAGER_DECISION_BRIEF). decisionStore 동반 필요. */
  decisionBrief?: boolean
  /** P4 advisory 채널(=MANAGER_WP_ADVISORY). off면 워커 동작 P4b와 동일(회귀 0). advisoryStore 동반 필요. */
  wpAdvisory?: boolean
}

/** P3-2 oracleConsumer 배선 판정(순수·D4): oracleDor(=MANAGER_ORACLE_DOR)와 oracleStore 주입이 둘 다 있어야 배선. */
export function shouldWireOracleConsumer(oracleDor: boolean, hasOracleStore: boolean): boolean {
  return oracleDor && hasOracleStore
}

/** P4b-1: WorkerConsumer deps 조립(순수·D4) — wpVerify→verifyEnabled 스레딩을 행동 단언 가능하게 분리.
 *  instanceOf 단언만으로는 이 한 줄의 누락(undefined→off)이 무음 fail-open 퇴행이 되는 것을 잡지 못한다. */
export function buildWorkerConsumerDeps(
  deps: Pick<SupervisorDeps, 'repo' | 'publish' | 'oracleStore' | 'leaseStore' | 'advisoryStore' | 'claude' | 'model' | 'timeoutMs'>
    & { handlers: Record<string, AgentExecutor> },
  config: SupervisorConfig,
): WorkerDeps {
  return {
    repo: deps.repo,
    handlers: deps.handlers,
    publish: deps.publish,
    completionStream: `${COMPLETION_PREFIX}:${DEFAULT_CHANNEL}`,
    verifyEnabled: config.wpVerify === true,
    // 하드닝: lease 하트비트 — 실행 중 renewLease로 가시성 연장(verify/conformance 다단계 호출 중 false reclaim 방지).
    // production 배선(createSupervisor)에서는 leaseStore+visibilityMs를 항상 동반(하트비트 항상-on). 워커는
    // 둘 중 하나라도 미주입이면 하트비트 비활성으로 방어(P4-1/P4b 동작 보존). LeaseStore가 renewLease를 구조적 만족.
    leaseStore: deps.leaseStore,
    visibilityMs: config.visibilityMs,
    // P4b-2: SupervisorDeps.oracleStore는 ConformanceOracleStore를 포함(server.ts가 OracleRepo 주입·approvedOracleForStory 보유).
    // 미주입이면 키 생략(exactOptionalPropertyTypes). conformanceEnabled는 flag+oracleStore 동반 시에만 true(검증 우회 무음 방지).
    ...(deps.oracleStore && { oracleStore: deps.oracleStore }),
    conformanceEnabled: config.wpConformance === true && deps.oracleStore != null,
    // P4 advisory: flag + advisoryStore 둘 다 있어야 활성(검증 우회 무음 방지·행동 단언). LLM seam 동반 스레딩.
    advisoryEnabled: config.wpAdvisory === true && deps.advisoryStore != null,
    ...(deps.advisoryStore && { advisoryStore: deps.advisoryStore }),
    ...(deps.claude && { claude: deps.claude }),
    ...(deps.model !== undefined && { model: deps.model }),
    ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
  }
}

/**
 * 실 컴포넌트 조립(server.ts용): DecompositionConsumer(영속+afterPersisted=디스패치) + completion BaseConsumer
 * + LeaseSweeper. 두 소비자는 xreadgroup BLOCK이 서로를 직렬화하지 않도록 **각자 전용 Redis 연결**을 받는다.
 */
export function createSupervisor(makeRedis: () => Redis, deps: SupervisorDeps, config: SupervisorConfig): Supervisor {
  // DoR 게이트 활성(satisfied-set 주입) = MANAGER_ORACLE_DOR && oracleStore 주입. DRAFT만 켜면 dorActive=false라
  // dispatch는 기본 술어로 동작하지만, decompositionConsumer는 oracleStore를 받아 upsertDraft만 수행(blocker#1 분리).
  const dorActive = config.oracleDor && deps.oracleStore !== undefined
  // P4-1: taskWorker flag + 핸들러 주입 둘 다 있어야 워커 배선(순수 게이트). 배선 시 dispatch/reclaim이
  // wp.dispatch_signal을 발행하고 WorkerConsumer가 이를 소비. off면 publish 미주입 → 신호 미발행(회귀 0).
  const workerActive = shouldWireWorker(config.taskWorker, deps.handlers !== undefined)
  const dispatch: DispatchDeps = {
    repo: deps.repo, store: deps.dispatchStore, visibilityMs: config.visibilityMs,
    ...(dorActive && { oracleStore: deps.oracleStore }),
    ...(workerActive && { publish: deps.publish }),
  }

  const decompositionConsumer = new DecompositionConsumer(
    makeRedis(), deps.repo, deps.publish, undefined,
    async (workflowId) => {
      await handleDispatch(workflowId, dispatch)
    },
    deps.oracleStore, // upsertDraft용 — DRAFT만 켜도 영속(blocker#1)
  )

  const completionConsumer = new BaseConsumer<CompletionSignalMessage>(
    makeRedis(),
    buildCompletionHandler({ leaseStore: deps.leaseStore, dispatch }),
    COMPLETION_GROUP,
    `manager-completion-${process.pid}`,
    COMPLETION_PREFIX,
    CompletionSignalSchema as ZodType<CompletionSignalMessage>,
  )

  // P6: decisionBrief flag + decisionStore 주입 둘 다 있어야 escalation→DecisionRequest 브리프 배선(회귀 0).
  const briefStore = config.decisionBrief ? deps.decisionStore : undefined
  const leaseSweeper = new LeaseSweeper(
    {
      store: deps.leaseStore, maxAttempts: config.maxAttempts, visibilityMs: config.visibilityMs,
      ...(workerActive && { publish: deps.publish }),
      ...(briefStore && { onEscalated: makeEscalationBrief(briefStore) }),
    },
    config.sweepMs,
  )

  // oracle.approved 소비자는 DoR 게이트(oracleDor)일 때만 배선(D4 순수 게이트). DRAFT-only면 미배선
  // (drafted 영속만·DoR 비활성). dorActive와 동치이나 순수 함수로 분리해 테스트 가능(toBeDefined만으론 미생성 검증 불가).
  const oracleConsumer = shouldWireOracleConsumer(config.oracleDor, deps.oracleStore !== undefined)
    ? new BaseConsumer<OracleApprovedMessage>(
        makeRedis(),
        buildOracleApprovedHandler(dispatch),
        ORACLE_GROUP,
        `manager-oracle-${process.pid}`,
        ORACLE_PREFIX,
        OracleApprovedSchema as ZodType<OracleApprovedMessage>,
      )
    : undefined

  // P4-1: 워커 소비자는 taskWorker+handlers 주입 시만 배선. 완료 발행 스트림을 completionConsumer 구독 스트림과
  // 단일 출처(COMPLETION_PREFIX:DEFAULT_CHANNEL)로 일치(드리프트 0). makeRedis()를 워커용으로 1회 더 호출
  // (소비자별 전용 연결·BLOCK 직렬화 회피·기존 패턴).
  const workerConsumer = workerActive && deps.handlers
    ? new WorkerConsumer(
        makeRedis(),
        buildWorkerConsumerDeps(
          // exactOptionalPropertyTypes: 미주입 deps는 키 생략(undefined 명시 불가). 기존 dispatch deps 조립 idiom.
          {
            repo: deps.repo, publish: deps.publish, handlers: deps.handlers, leaseStore: deps.leaseStore,
            ...(deps.oracleStore && { oracleStore: deps.oracleStore }),
            ...(deps.advisoryStore && { advisoryStore: deps.advisoryStore }),
            ...(deps.claude && { claude: deps.claude }),
            ...(deps.model !== undefined && { model: deps.model }),
            ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
          },
          config,
        ),
      )
    : undefined

  return new Supervisor({
    decompositionConsumer, completionConsumer, leaseSweeper,
    ...(oracleConsumer && { oracleConsumer }),
    ...(workerConsumer && { workerConsumer }),
  })
}
