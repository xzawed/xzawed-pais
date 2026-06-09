import { type ZodType } from 'zod'
import type { Redis } from 'ioredis'
import { BaseConsumer, makeEnvelope } from '@xzawed/agent-streams'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { Publish } from './decomposition-consumer.js'
import { WpDispatchSignalSchema, type WpDispatchSignalMessage } from './dispatch-signal.js'
import { resolveAgentTool } from '../tools/agent-tool-map.js'

const WORKER_GROUP = 'manager-worker-consumers'
const STREAM_PREFIX = 'manager:dispatched'
const DEFAULT_COMPLETION_STREAM = 'manager:completions:main'
const WP_COMPLETION = 'wp.completion'

/** 에이전트 실행 최소 구조(RedisAgentHandler.execute가 만족 — userContext 옵셔널 인자 무관). */
export interface AgentExecutor {
  execute(input: unknown, sessionId: string): Promise<unknown>
}

export interface WorkerDeps {
  repo: Pick<TaskGraphRepo, 'getGraph'>
  /** tool명(resolveAgentTool 결과) → 핸들러. server.ts가 registry.get으로 주입. */
  handlers: Record<string, AgentExecutor>
  publish: Publish
  /** 완료 신호 스트림(기본 manager:completions:main; createSupervisor가 COMPLETION_PREFIX:channel 주입). */
  completionStream?: string
  buildInput?: (wp: WorkPackage) => unknown
  now?: () => number
}

export type WorkerOutcome =
  | { status: 'completed'; wpId: string }
  | { status: 'skipped'; reason: 'wp_not_found' | 'unknown_role' | 'no_handler' }
  | { status: 'failed'; reason: 'agent_error' }

/** WP→에이전트 입력(최소·placeholder 품질). 값은 runner.ts `buildAgentQueryPayload`의 **검증된 union**과 동일 —
 *  5종 답변자(developer/designer/tester/builder/security) safeParse 통과(Zod 잉여 키 strip). intent만 WP 설명으로 교체.
 *  ⚠️ context는 `z.record`(객체), target은 빌더 enum 'development', severity는 'low' — string/storyId면 safeParse 실패. */
export function buildWorkerInput(wp: WorkPackage): Record<string, unknown> {
  const acList = wp.acceptanceCriteria.map((a) => `- ${a}`).join('\n')
  const intent = wp.acceptanceCriteria.length
    ? `Implement story ${wp.storyId}.\nAcceptance criteria:\n${acList}`
    : `Implement story ${wp.storyId}.`
  return { intent, context: {}, priority: 'normal', projectPath: '', target: 'development', severity: 'low', artifacts: [] }
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
  const input = (deps.buildInput ?? buildWorkerInput)(wp)
  try {
    await handler.execute(input, workflowId)
  } catch {
    return { status: 'failed', reason: 'agent_error' } // 신호 미발행 → lease 타임아웃 reclaim
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
