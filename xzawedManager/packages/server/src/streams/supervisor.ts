import type { Redis } from 'ioredis'
import { z, type ZodType } from 'zod'
import { BaseConsumer, EventEnvelopeSchema } from '@xzawed/agent-streams'
import { DecompositionConsumer, type Publish } from './decomposition-consumer.js'
import { handleDispatch, type DispatchDeps, type OracleStore } from './dispatch.js'
import { buildOracleApprovedHandler, OracleApprovedSchema, type OracleApprovedMessage } from './oracle-consumer.js'
import { handleCompletion } from './completion.js'
import { LeaseSweeper } from './lease-sweeper.js'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { DispatchStore } from '../db/dispatch.repo.js'
import type { LeaseStore } from '../db/lease.repo.js'

const COMPLETION_GROUP = 'manager-completion-consumers'
const COMPLETION_PREFIX = 'manager:completions'
const ORACLE_GROUP = 'manager-oracle-consumers'
const ORACLE_PREFIX = 'manager:oracle'
const DEFAULT_CHANNEL = 'main'

/** 워커 완료 신호(잠정 — 생산자 도착 시 확정). workflowId는 봉투, wpId는 payload. */
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
    this.components.leaseSweeper.start()
  }

  stop(): void {
    this.components.decompositionConsumer.stop()
    this.components.completionConsumer.stop()
    this.components.oracleConsumer?.stop()
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
  /** P3-1: 주입 시 dispatch에 satisfied-set·oracle.approved 소비자 배선(MANAGER_ORACLE_DOR). */
  oracleStore?: OracleStore
}
export interface SupervisorConfig {
  sweepMs: number
  visibilityMs: number
  maxAttempts: number
}

/**
 * 실 컴포넌트 조립(server.ts용): DecompositionConsumer(영속+afterPersisted=디스패치) + completion BaseConsumer
 * + LeaseSweeper. 두 소비자는 xreadgroup BLOCK이 서로를 직렬화하지 않도록 **각자 전용 Redis 연결**을 받는다.
 */
export function createSupervisor(makeRedis: () => Redis, deps: SupervisorDeps, config: SupervisorConfig): Supervisor {
  const dispatch: DispatchDeps = {
    repo: deps.repo, store: deps.dispatchStore, visibilityMs: config.visibilityMs,
    ...(deps.oracleStore && { oracleStore: deps.oracleStore }),
  }

  const decompositionConsumer = new DecompositionConsumer(
    makeRedis(), deps.repo, deps.publish, undefined,
    async (workflowId) => {
      await handleDispatch(workflowId, dispatch)
    },
  )

  const completionConsumer = new BaseConsumer<CompletionSignalMessage>(
    makeRedis(),
    buildCompletionHandler({ leaseStore: deps.leaseStore, dispatch }),
    COMPLETION_GROUP,
    `manager-completion-${process.pid}`,
    COMPLETION_PREFIX,
    CompletionSignalSchema as ZodType<CompletionSignalMessage>,
  )

  const leaseSweeper = new LeaseSweeper(
    { store: deps.leaseStore, maxAttempts: config.maxAttempts, visibilityMs: config.visibilityMs },
    config.sweepMs,
  )

  const oracleConsumer = deps.oracleStore
    ? new BaseConsumer<OracleApprovedMessage>(
        makeRedis(),
        buildOracleApprovedHandler(dispatch),
        ORACLE_GROUP,
        `manager-oracle-${process.pid}`,
        ORACLE_PREFIX,
        OracleApprovedSchema as ZodType<OracleApprovedMessage>,
      )
    : undefined

  return new Supervisor({ decompositionConsumer, completionConsumer, leaseSweeper, ...(oracleConsumer && { oracleConsumer }) })
}
