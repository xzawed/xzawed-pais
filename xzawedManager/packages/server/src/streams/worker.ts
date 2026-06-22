import { type ZodType } from 'zod'
import type { Redis } from 'ioredis'
import { BaseConsumer, makeEnvelope } from '@xzawed/agent-streams'
import type { WorkPackage, WpRisk } from '@xzawed/agent-streams'
import type { RoutedAgent, ModelTier } from '@xzawed/agent-streams'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { UserContext } from '../types/user-context.js'
import type { Publish } from './decomposition-consumer.js'
import type { ConformanceOracleStore, ImpactOracleStore, InvariantOracleStore } from './conformance.js'
import { WpDispatchSignalSchema, type WpDispatchSignalMessage } from './dispatch-signal.js'
import { resolveAgentTool } from '../tools/agent-tool-map.js'
import { verifyWp, publishVerificationFailed, type SecuritySeverity } from './verify.js'
import type { ChannelOutcome } from '../db/release-gate.types.js'
import { produceAdvisory, type AdvisoryStore } from './advisory.js'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { DONE_STATE, ESCALATED_STATE } from './dispatch-constants.js'
import { resolveWpModel, type ModelTierIds } from './model-routing.js'

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
  buildInput?: (wp: WorkPackage, userContext?: UserContext, model?: string) => Record<string, unknown>
  now?: () => number
  /** P4b-1: 검증 게이트(=MANAGER_WP_VERIFY). on이면 완료 발행 전 verifyWp fail-closed 판정 —
   *  실패 시 완료 미발행(lease 백스톱이 reclaim→escalate) + wp.verification.failed 관측 이벤트. */
  verifyEnabled?: boolean
  /** P4b-2/P4: 승인 오라클 조회 포트(conformance scenarios + impact golden_refs). verifyWp로 전달. */
  oracleStore?: ConformanceOracleStore & ImpactOracleStore & InvariantOracleStore
  /** P4b-2: conformance 채널 활성(=MANAGER_WP_CONFORMANCE && oracleStore 주입). */
  conformanceEnabled?: boolean
  /** P4: impact golden-differential 채널 활성(=MANAGER_WP_IMPACT && oracleStore 주입). verifyWp로 전달. */
  impactEnabled?: boolean
  /** P4: property/invariants 채널 활성(=MANAGER_WP_PROPERTY && oracleStore 주입). verifyWp로 전달. */
  propertyEnabled?: boolean
  /** P4 mutation θ_risk 채널 활성(=MANAGER_WP_MUTATION). oracle 미소비. verifyWp로 전달. */
  mutationEnabled?: boolean
  mutationTheta?: number
  mutationMinRisk?: WpRisk
  mutationMaxMutants?: number
  /** P4 4d security 채널 활성(=MANAGER_WP_SECURITY). oracle 미소비. verifyWp로 전달. */
  securityEnabled?: boolean
  securityMinSeverity?: SecuritySeverity
  /** 하드닝: lease 하트비트 — 실행 중 renewLease로 가시성 연장(verify/conformance 다단계 호출 중 false reclaim 방지).
   *  leaseStore+visibilityMs 둘 다 주입 시에만 활성(미주입=P4b 동작 보존·회귀 0). */
  leaseStore?: { renewLease(workflowId: string, wpId: string, expectedAttempt: number, visibilityMs: number): Promise<boolean> }
  /** lease 가시성 ms — 하트비트 연장량 + 갱신 주기(visibilityMs/3) 도출. */
  visibilityMs?: number
  /** D5: 승인 modelRouting 조회 포트(approvedForWorkflow). MANAGER_MODEL_ROUTING + riskStore 주입 시만. */
  riskStore?: { approvedForWorkflow(workflowId: string): Promise<{ modelRouting: Record<RoutedAgent, ModelTier> } | null> }
  /** D5: tier→concrete model id. MANAGER_MODEL_ROUTING 시 주입. */
  modelRouting?: ModelTierIds
  /** P4 advisory 채널(=MANAGER_WP_ADVISORY && advisoryStore 주입). develop_code WP의 verdict.ok 후 비차단 생산. */
  advisoryEnabled?: boolean
  advisoryStore?: AdvisoryStore
  /** P4 advisory 생산자 LLM seam(produceAdvisory용). advisoryEnabled 시 동반 주입. */
  claude?: ClaudeLike
  model?: string
  timeoutMs?: number
  /** P5-1 릴리스 게이트: verdict.ok 시 채널 증거를 영속(best-effort). off면 미주입(회귀 0). */
  releaseGateEnabled?: boolean
  releaseStore?: { recordEvidence(workflowId: string, wpId: string, attempt: number, outcomes: ChannelOutcome[]): Promise<void> }
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
export function buildWorkerInput(wp: WorkPackage, userContext?: UserContext, model?: string): Record<string, unknown> {
  const acList = wp.acceptanceCriteria.map((a) => `- ${a}`).join('\n')
  const fullIntent = wp.acceptanceCriteria.length
    ? `Implement story ${wp.storyId}.\nAcceptance criteria:\n${acList}`
    : `Implement story ${wp.storyId}.`
  // planner/designer intent는 .max(4000) — AC 합계가 길면 safeParse 실패→DLQ→타임아웃이므로
  // runner.ts buildAgentQueryPayload와 동일하게 클램프(AC 전체는 plan에 무손실 보존 — developer가 읽음).
  const intent = fullIntent.slice(0, 4000)
  const projectPath = userContext?.workspaceRoot ?? '.'
  return { intent, plan: fullIntent, context: {}, priority: 'normal', projectPath, target: 'development', severity: 'low', artifacts: [], ...(model !== undefined && { model }) }
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

export interface HeartbeatTimers {
  set: (cb: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}
const realTimers: HeartbeatTimers = {
  set: (cb, ms) => {
    const t = setInterval(cb, ms)
    // unref: 하트비트 타이머가 프로세스 종료를 막지 않게(stop 누락 시 안전망).
    ;(t as { unref?: () => void }).unref?.()
    return t
  },
  clear: (h) => { clearInterval(h as Parameters<typeof clearInterval>[0]) },
}

/**
 * lease 하트비트: intervalMs마다 renew를 호출해 가시성 만료·false reclaim을 방지한다. renew는 never-throw로
 * 감싸 전송/DB 오류가 워커 처리를 죽이지 않게 한다. 반환 stop()을 finally에서 호출해 타이머를 정리한다.
 * 주입형 timers로 테스트 용이(fake interval).
 */
export function startLeaseHeartbeat(
  renew: () => Promise<unknown>, intervalMs: number, timers: HeartbeatTimers = realTimers,
): { stop: () => void } {
  const handle = timers.set(() => { void Promise.resolve(renew()).catch(() => undefined) }, intervalMs)
  return { stop: () => timers.clear(handle) }
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
  // D5: 승인 modelRouting 조회→해석(never-throw·실패/null→폴백). flag off(riskStore/modelRouting 미주입)면 조회 0.
  let routedModel: string | undefined
  if (deps.riskStore && deps.modelRouting) {
    const approved = await deps.riskStore.approvedForWorkflow(workflowId).catch(() => null)
    routedModel = resolveWpModel(approved?.modelRouting, wp.owningRole, deps.modelRouting)
  }
  const input = (deps.buildInput ?? buildWorkerInput)(wp, userContext, routedModel)
  // 하드닝: 장기 실행(verify/conformance는 WP당 다단계 에이전트 호출·최대 5×120s) 중 lease 가시성 만료·
  // false reclaim을 막기 위해 실행 동안 주기적으로 renewLease(하트비트). leaseStore+visibilityMs 주입 시에만
  // 활성(미주입=P4-1/P4b 동작 보존·회귀 0). stop()은 finally에서 모든 종료 경로에 보장.
  const heartbeat =
    deps.leaseStore !== undefined && deps.visibilityMs !== undefined
      ? startLeaseHeartbeat(
          async () => {
            // 0행 = lease가 reclaim(attempt++)·escalate·release돼 stale — 가시성 연장 무효. 워커는 stale 작업
            // 중일 수 있으나 완료는 lease-active 가드로 멱등 차단되고 후속 신호가 새 attempt로 재실행한다. 관측 로그.
            const ok = await deps.leaseStore!.renewLease(workflowId, wpId, msg.payload.attempt, deps.visibilityMs!)
            if (!ok) console.warn(`[worker] lease 하트비트 갱신 0행(stale lease — reclaim/escalate/release 가능): ${workflowId}/${wpId} attempt=${msg.payload.attempt}`)
          },
          Math.max(1000, Math.floor(deps.visibilityMs / 3)), // 가시성 창당 ~3회 갱신
        )
      : undefined
  try {
    let result: unknown
    try {
      result = await handler.execute(input, workflowId, userContext)
    } catch {
      return { status: 'failed', reason: 'agent_error' } // 신호 미발행 → lease 타임아웃 reclaim
    }
    // P4b-1 검증 게이트: trivial(무예외=성공)을 실행 ground truth fail-closed 판정으로 교체(N1).
    const gate = await runVerifyGate(tool, wp, result, msg, userContext, deps)
    if (gate) return gate // 실패 = 완료 미발행(lease 백스톱 reclaim→escalate·N5) + 관측 이벤트.
    // P4 advisory(N3): verdict가 이미 확정된 뒤에만 비차단 생산 — 게이트는 advisory를 모른다.
    await maybeProduceAdvisory(tool, workflowId, wp, msg.payload.attempt, result, deps)
    await publishCompletion(deps, workflowId, wpId, msg.payload.attempt)
    return { status: 'completed', wpId }
  } finally {
    heartbeat?.stop()
  }
}

/** P4b 검증 게이트(verifyEnabled): verdict 실패면 관측 이벤트 발행 + outcome 반환, ok/비활성이면 null(계속).
 *  handleWpDispatchSignal의 인지복잡도를 낮추려 추출(동작 불변·N1). */
async function runVerifyGate(
  tool: string, wp: WorkPackage, result: unknown, msg: WpDispatchSignalMessage,
  userContext: UserContext | undefined, deps: WorkerDeps,
): Promise<WorkerOutcome | null> {
  if (!deps.verifyEnabled) return null
  const { workflowId } = msg.envelope
  const collect = deps.releaseGateEnabled === true && deps.releaseStore !== undefined
  const evidence: ChannelOutcome[] = []
  const verdict = await verifyWp(tool, wp, result, {
    handlers: deps.handlers, buildInput: deps.buildInput ?? buildWorkerInput, userContext, workflowId,
    attempt: msg.payload.attempt,
    ...(deps.oracleStore && { oracleStore: deps.oracleStore }),
    conformanceEnabled: deps.conformanceEnabled === true,
    impactEnabled: deps.impactEnabled === true,
    propertyEnabled: deps.propertyEnabled === true,
    mutationEnabled: deps.mutationEnabled === true,
    ...(deps.mutationTheta !== undefined && { mutationTheta: deps.mutationTheta }),
    ...(deps.mutationMinRisk !== undefined && { mutationMinRisk: deps.mutationMinRisk }),
    ...(deps.mutationMaxMutants !== undefined && { mutationMaxMutants: deps.mutationMaxMutants }),
    securityEnabled: deps.securityEnabled === true,
    ...(deps.securityMinSeverity !== undefined && { securityMinSeverity: deps.securityMinSeverity }),
    ...(collect && { recordOutcome: (c: ChannelOutcome['channel'], o: ChannelOutcome['outcome']) => evidence.push({ channel: c, outcome: o }) }),
  })
  if (verdict.ok) {
    if (collect) await persistVerificationEvidence(deps, workflowId, msg, evidence)
    return null
  }
  try {
    await publishVerificationFailed(deps.publish, workflowId, msg.payload.wpId, msg.payload.attempt, verdict.reason, deps.now?.())
  } catch (err) {
    console.error('[worker] wp.verification.failed 발행 실패(완료 부재가 reclaim 보장):', err)
  }
  return { status: 'verification_failed', wpId: msg.payload.wpId, reason: verdict.reason }
}

/** P5-1: verdict.ok 시 수집한 채널 증거를 best-effort 영속(완료를 막지 않음·게이트는 증거 부재를 un-proven 처리). */
async function persistVerificationEvidence(
  deps: WorkerDeps, workflowId: string, msg: WpDispatchSignalMessage, evidence: ChannelOutcome[],
): Promise<void> {
  if (evidence.length === 0 || !deps.releaseStore) return
  try {
    await deps.releaseStore.recordEvidence(workflowId, msg.payload.wpId, msg.payload.attempt, evidence)
  } catch (err) {
    console.error('[worker] wp.verified 증거 영속 실패(게이트는 증거 부재를 un-proven 처리):', err)
  }
}

/** P4 advisory(N3): develop_code WP의 verdict.ok 후 비차단 optimization 제안을 생산한다(produceAdvisory는
 *  best-effort never-throw — 게이트·완료에 영향 0). flag+LLM seam+advisoryStore 전부 주입 시에만 동작. */
async function maybeProduceAdvisory(
  tool: string, workflowId: string, wp: WorkPackage, attempt: number, result: unknown, deps: WorkerDeps,
): Promise<void> {
  if (
    !deps.advisoryEnabled || tool !== 'develop_code' ||
    !deps.advisoryStore || !deps.claude || !deps.model || deps.timeoutMs === undefined
  ) {
    return
  }
  await produceAdvisory(workflowId, wp, attempt, result, {
    claude: deps.claude, model: deps.model, timeoutMs: deps.timeoutMs, advisoryStore: deps.advisoryStore,
  })
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
