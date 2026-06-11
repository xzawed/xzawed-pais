import { type ZodType } from 'zod'
import type { Redis } from 'ioredis'
import { BaseConsumer, makeEnvelope } from '@xzawed/agent-streams'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { UserContext } from '../types/user-context.js'
import type { Publish } from './decomposition-consumer.js'
import type { ConformanceOracleStore } from './conformance.js'
import { WpDispatchSignalSchema, type WpDispatchSignalMessage } from './dispatch-signal.js'
import { resolveAgentTool } from '../tools/agent-tool-map.js'
import { verifyWp, publishVerificationFailed } from './verify.js'
import { DONE_STATE, ESCALATED_STATE } from './dispatch-constants.js'

const WORKER_GROUP = 'manager-worker-consumers'
const STREAM_PREFIX = 'manager:dispatched'
const DEFAULT_COMPLETION_STREAM = 'manager:completions:main'
const WP_COMPLETION = 'wp.completion'

/** 에이전트 실행 최소 구조(RedisAgentHandler.execute가 만족). userContext(P4a-2)는 옵셔널 3번째 인자 —
 *  2-인자 구현(일반 ToolHandler)도 구조적으로 할당 가능(잉여 인자는 무시). */
export interface AgentExecutor {
  execute(input: unknown, sessionId: string, userContext?: UserContext): Promise<unknown>
}

export interface WorkerDeps {
  /** P4b-1: latestStates는 verifyEnabled 시 스테일 신호(DONE/ESCALATED WP) skip 가드에 사용. */
  repo: Pick<TaskGraphRepo, 'getGraph' | 'latestStates'>
  /** tool명(resolveAgentTool 결과) → 핸들러. server.ts가 registry.get으로 주입. */
  handlers: Record<string, AgentExecutor>
  publish: Publish
  /** 완료 신호 스트림(기본 manager:completions:main; createSupervisor가 COMPLETION_PREFIX:channel 주입). */
  completionStream?: string
  buildInput?: (wp: WorkPackage, userContext?: UserContext) => Record<string, unknown>
  now?: () => number
  /** P4b-1: 검증 게이트(=MANAGER_WP_VERIFY). on이면 완료 발행 전 verifyWp fail-closed 판정 —
   *  실패 시 완료 미발행(lease 백스톱이 reclaim→escalate) + wp.verification.failed 관측 이벤트. */
  verifyEnabled?: boolean
  /** P4b-2: 승인 오라클 조회 포트(conformance 채널). verifyWp로 전달. */
  oracleStore?: ConformanceOracleStore
  /** P4b-2: conformance 채널 활성(=MANAGER_WP_CONFORMANCE && oracleStore 주입). */
  conformanceEnabled?: boolean
}

export type WorkerOutcome =
  | { status: 'completed'; wpId: string }
  | { status: 'skipped'; reason: 'wp_not_found' | 'unknown_role' | 'no_handler' | 'stale_signal' }
  | { status: 'failed'; reason: 'agent_error' }
  | { status: 'verification_failed'; wpId: string; reason: string }

/** WP→에이전트 입력. 필수 필드는 runner.ts `buildAgentQueryPayload`의 **검증된 union**과
 *  같은 타입(5종 safeParse 통과·Zod 잉여 키 strip). intent/plan에 WP 설명을 담는다.
 *  ⚠️ context는 `z.record`(객체), target은 빌더 enum 'development', severity는 'low'(string/storyId면 safeParse 실패).
 *  ⚠️ projectPath(P4a-2): userContext 존재 시 workspaceRoot **절대경로** — builder/tester `validatePath`는
 *  `fs.realpath(projectPath)`를 에이전트 cwd 기준으로 해석하므로 '.'는 cwd≠workspaceRoot 배포에서 거부(NEW-2).
 *  절대경로는 cwd 무관 + `path.relative(realRoot, realProject)=''`로 containment 통과. 미존재 시 '.' 폴백(P4-1 동작 보존). */
export function buildWorkerInput(wp: WorkPackage, userContext?: UserContext): Record<string, unknown> {
  const acList = wp.acceptanceCriteria.map((a) => `- ${a}`).join('\n')
  const fullIntent = wp.acceptanceCriteria.length
    ? `Implement story ${wp.storyId}.\nAcceptance criteria:\n${acList}`
    : `Implement story ${wp.storyId}.`
  // planner/designer intent는 .max(4000) — AC 합계가 길면 safeParse 실패→DLQ→타임아웃이므로
  // runner.ts buildAgentQueryPayload와 동일하게 클램프(AC 전체는 plan에 무손실 보존 — developer가 읽음).
  const intent = fullIntent.slice(0, 4000)
  const projectPath = userContext?.workspaceRoot ?? '.'
  return { intent, plan: fullIntent, context: {}, priority: 'normal', projectPath, target: 'development', severity: 'low', artifacts: [] }
}

/** 워커 배선 판정(순수·D4 패턴): taskWorker flag + 핸들러 주입 둘 다 있어야 배선. */
export function shouldWireWorker(taskWorker: boolean, hasHandlers: boolean): boolean {
  return taskWorker && hasHandlers
}

/** 완료 신호 발행. attemptId=신호의 attempt(reclaim 재완료가 dedup에 막히지 않도록 — :0 하드코딩 시
 *  dedup-claim 후 크래시한 완료가 attempt++ 재완료를 같은 키로 차단). handleCompletion은 lease-active 가드로 멱등. */
async function publishCompletion(deps: WorkerDeps, workflowId: string, wpId: string, attempt: number): Promise<void> {
  const now = deps.now?.() ?? Date.now()
  const envelope = makeEnvelope(
    { correlationId: workflowId, causationId: null, workflowId, stepId: `${WP_COMPLETION}:${wpId}`, attemptId: attempt },
    now,
  )
  await deps.publish(deps.completionStream ?? DEFAULT_COMPLETION_STREAM, { envelope, type: WP_COMPLETION, payload: { wpId } })
}

/**
 * 트리거 신호 1건 처리: getGraph→WP 해석→resolveAgentTool(owningRole)→핸들러 자율 호출→성공 시 wp.completion 발행.
 * 실패/미해석은 신호 미발행 후 return(lease 백스톱이 reclaim·결정 2/5). 검증 trivial(실 검증=4b).
 * P4a-2: 그래프에 영속된 userContext(워크스페이스 컨텍스트)를 입력·execute에 주입 — RedisAgentHandler가
 * payload.userContext로 spread해 에이전트가 resolveWorkspaceRoot로 소비(실 에이전트 성공 성립).
 */
export async function handleWpDispatchSignal(msg: WpDispatchSignalMessage, deps: WorkerDeps): Promise<WorkerOutcome> {
  const { workflowId } = msg.envelope
  const { wpId } = msg.payload
  const stored = await deps.repo.getGraph(workflowId)
  const wp = stored?.workPackages.find((w) => w.id === wpId)
  if (!wp) return { status: 'skipped', reason: 'wp_not_found' }
  const tool = resolveAgentTool(wp.owningRole)
  if (!tool) return { status: 'skipped', reason: 'unknown_role' }
  const handler = deps.handlers[tool]
  if (!handler) return { status: 'skipped', reason: 'no_handler' }
  // P4b-1 스테일 신호 가드: 검증 게이트는 WP당 처리 시간을 최대 3×120s로 늘려 lease 가시성 창을 넘을 수
  // 있고, 그때 false reclaim이 남긴 attempt-N 신호가 이미 DONE된 WP를 통째로 재실행해 워크스페이스를
  // 재변형한다 — 실행 전 최신 상태가 DONE/ESCALATED면 skip. flag off 경로는 P4-1 동작 보존(조회 0).
  if (deps.verifyEnabled) {
    const states = await deps.repo.latestStates(workflowId)
    const current = states.get(wpId)?.toState
    if (current === DONE_STATE || current === ESCALATED_STATE) {
      return { status: 'skipped', reason: 'stale_signal' }
    }
  }
  const userContext = stored?.userContext ?? undefined
  const input = (deps.buildInput ?? buildWorkerInput)(wp, userContext)
  let result: unknown
  try {
    result = await handler.execute(input, workflowId, userContext)
  } catch {
    return { status: 'failed', reason: 'agent_error' } // 신호 미발행 → lease 타임아웃 reclaim
  }
  // P4b-1 검증 게이트: trivial(무예외=성공)을 실행 ground truth fail-closed 판정으로 교체(N1).
  // 실패 = 완료 미발행(lease 백스톱 reclaim→escalate·N5) + 관측 이벤트(best-effort 추적용).
  if (deps.verifyEnabled) {
    const verdict = await verifyWp(tool, wp, result, {
      handlers: deps.handlers, buildInput: deps.buildInput ?? buildWorkerInput, userContext, workflowId,
      attempt: msg.payload.attempt,
      ...(deps.oracleStore && { oracleStore: deps.oracleStore }),
      conformanceEnabled: deps.conformanceEnabled === true,
    })
    if (!verdict.ok) {
      try {
        await publishVerificationFailed(deps.publish, workflowId, wpId, msg.payload.attempt, verdict.reason, deps.now?.())
      } catch (err) {
        console.error('[worker] wp.verification.failed 발행 실패(완료 부재가 reclaim 보장):', err)
      }
      return { status: 'verification_failed', wpId, reason: verdict.reason }
    }
  }
  await publishCompletion(deps, workflowId, wpId, msg.payload.attempt)
  return { status: 'completed', wpId }
}

export function buildWorkerHandler(deps: WorkerDeps): (msg: WpDispatchSignalMessage) => Promise<void> {
  return async (msg) => {
    await handleWpDispatchSignal(msg, deps)
  }
}

/** wp.dispatch_signal 소비자(BaseConsumer·dedup ON). start('main') → manager:dispatched:main 구독. */
export class WorkerConsumer extends BaseConsumer<WpDispatchSignalMessage> {
  constructor(redis: Redis, deps: WorkerDeps, sleep?: (ms: number) => Promise<void>) {
    super(
      redis,
      buildWorkerHandler(deps),
      WORKER_GROUP,
      `manager-worker-${process.pid}`,
      STREAM_PREFIX,
      WpDispatchSignalSchema as ZodType<WpDispatchSignalMessage>,
      sleep,
    )
  }
}
