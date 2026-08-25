import type { Redis } from 'ioredis'
import { z, type ZodType } from 'zod'
import {
  BaseConsumer,
  EventEnvelopeSchema,
  WorkPackageSchema,
  buildTaskGraph,
  detectCycle,
  makeEnvelope,
  mergeKeepInflight,
  WP_INFLIGHT_STATES,
} from '@xzawed/agent-streams'
import type { TaskGraph, WorkPackage, WpStatus } from '@xzawed/agent-streams'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import { OracleDraftSchema } from '../db/oracle.types.js'
import type { OracleScenario, OracleInvariant } from '../db/oracle.types.js'
import { AbsoluteUserContextSchema } from '../types/user-context.js'
import { buildOracleBrief } from './oracle-brief.js'
import type { DecisionRequestInput } from './decision-brief.js'
import { formatInconsistentReason, buildDecomposeFailureBrief } from './decompose-failure.js'

// 단일 type 스트림(manager:decomposition:{wf})용 스키마 — 다른 type 메시지가 들어오면
// BaseConsumer가 invalid_schema로 DLQ 격리한다(의도된 동작; P1d-4가 이 스트림을 다중화하면 재검토).
export const DecompositionEmittedSchema = z.object({
  envelope: EventEnvelopeSchema,
  type: z.literal('decomposition.emitted'),
  payload: z.object({
    workPackages: z.array(WorkPackageSchema),
    // P3-2: 초안 오라클(additive·off면 producer가 []로 발행). consumer가 upsertDraft로 영속.
    oracleDrafts: z.array(OracleDraftSchema).default([]),
    // P4a-2: 워크스페이스 컨텍스트(additive optional) — 그래프에 영속돼 실행 워커가 주입.
    // 절대경로 강제(자율 실행 경로) — 위반 메시지는 BaseConsumer invalid_schema DLQ 격리.
    userContext: AbsoluteUserContextSchema.optional(),
    // S7.2: 이 그래프를 만든 분해 입력(additive optional) — 그래프에 영속돼 `spec_fix` 재분해가 쓴다.
    // 부재는 정상이다(레거시 발행·재분해 경로) — 그때는 기존 값을 이월한다.
    intent: z.string().min(1).optional(),
  }),
})
export type DecompositionEmittedMessage = z.infer<typeof DecompositionEmittedSchema>

export type InconsistentReason = 'cycle' | 'structural' | 'coverage'
export type Publish = (stream: string, message: Record<string, unknown>) => Promise<unknown>

export interface DecompositionDeps {
  repo: TaskGraphRepo
  publish: Publish
  /** inconsistent 출력 스트림 키 빌더(기본 manager:events:{workflowId}). */
  inconsistentStream?: (workflowId: string) => string
  now?: () => number
  /** P3-2: 주입 시 oracleDrafts를 pending 오라클로 upsert(oracleId는 repo가 workflowId로 파생·D2). */
  oracleStore?: {
    upsertDraft: (input: {
      workflowId: string
      storyId: string
      scenarios: OracleScenario[]
      coverage: Record<string, string[]>
      invariants: OracleInvariant[]
      /** G11 Slice 4: userContext.tenantId 유래(부재는 null). */
      tenantId: string | null
    }) => Promise<void>
  }
  /** C3: 주입 시 draft 영속 후 oracle_approval DecisionRequest 발행(MANAGER_ORACLE_DECISION). best-effort.
   *  G11 Slice 4 리뷰 수정: tenantId를 seam에서 필수화(decision-brief.ts DecisionBriefStore와 동일 이유). */
  decisionStore?: { createRequest(input: DecisionRequestInput & { tenantId: string | null }): Promise<unknown> }
  /** C7 arm1(무조건): inconsistent 시 사람에게 error 노출(manager:to-orchestrator:{wf}). best-effort. */
  notifyUser?: (workflowId: string, content: string) => Promise<void>
  /** C7 arm2(MANAGER_DECISION_ROUTING): inconsistent 시 decompose_inconsistent DecisionRequest 발행. best-effort.
   *  G11 Slice 4 리뷰 수정: tenantId를 seam에서 필수화. */
  failureDecisionStore?: { createRequest(input: DecisionRequestInput & { tenantId: string | null }): Promise<unknown> }
}

export type DecompositionOutcome =
  | { status: 'persisted'; version: number }
  | { status: 'inconsistent'; reason: InconsistentReason }

const CONSUMER_GROUP = 'manager-taskgraph-consumers'
const STREAM_PREFIX = 'manager:decomposition'
// 입력(manager:decomposition)과 의도적으로 분리된 출력 스트림(자기소비 루프 방지). 세션 이벤트소싱
// 스트림(session.store.ts)과 네임스페이스를 공유하므로, 다운스트림 소비자(P1d-4/Supervisor)는
// decomposition.inconsistent를 세션 이벤트와 함께 처리할 수 있어야 한다.
export const defaultInconsistentStream = (workflowId: string): string => `manager:events:${workflowId}`

/** decomposition.inconsistent 이벤트를 인과(causation=원 eventId) 봉투로 출력 스트림에 발행. */
async function emitInconsistent(
  msg: DecompositionEmittedMessage,
  deps: DecompositionDeps,
  reason: InconsistentReason,
  extra: Record<string, unknown>,
): Promise<void> {
  const env = makeEnvelope(
    {
      correlationId: msg.envelope.correlationId,
      causationId: msg.envelope.eventId,
      workflowId: msg.envelope.workflowId,
      stepId: 'decomposition.inconsistent',
      attemptId: 0,
    },
    deps.now?.(),
  )
  const stream = (deps.inconsistentStream ?? defaultInconsistentStream)(msg.envelope.workflowId)
  await deps.publish(stream, { envelope: env, type: 'decomposition.inconsistent', payload: { reason, ...extra } })
}

/** C7: inconsistent를 사람에게 노출 — arm1 notifyUser(error·무조건) + arm2 failureDecisionStore(decompose_inconsistent·projectId 존재 시). 둘 다 best-effort never-throw(소비 비차단). */
async function surfaceInconsistent(
  msg: DecompositionEmittedMessage,
  deps: DecompositionDeps,
  reason: InconsistentReason,
  detail?: string,
): Promise<void> {
  const wf = msg.envelope.workflowId
  if (deps.notifyUser) {
    try {
      await deps.notifyUser(wf, formatInconsistentReason(reason, detail))
    } catch (err) {
      console.warn('[decomposition] inconsistent notifyUser 실패(best-effort):', err)
    }
  }
  const projectId = msg.payload.userContext?.projectId ?? null
  if (deps.failureDecisionStore && projectId !== null) {
    try {
      await deps.failureDecisionStore.createRequest({
        ...buildDecomposeFailureBrief({ workflowId: wf, projectId, reason, ...(detail !== undefined && { detail }) }),
        // G11 Slice 4: 테넌트 태그를 userContext에서 파생(추가 조회 0).
        tenantId: msg.payload.userContext?.tenantId ?? null,
      })
    } catch (err) {
      console.warn('[decomposition] decompose_inconsistent 발행 실패(best-effort):', err)
    }
  }
}

type MergeResult =
  /** S7.2: `storedIntent` 는 기존 그래프의 분해 입력 — 새 발행에 intent 가 없을 때 이월용(추가 조회 0). */
  | { ok: true; workPackages: WorkPackage[]; storedIntent?: string | null }
  | { ok: false; reason: InconsistentReason; detail: string }

/**
 * 재진입 병합(S6.2) — 기존 그래프의 **진행 중 WP 와 그 의존 폐포**를 보존한 채 incoming 을 적용한다.
 *
 * **술어는 `wp.status` 가 아니라 `latestStates` 에서 온다.** `graph_dag` 의 status 는 프로덕션에서
 * 영원히 `DRAFTED` 이고(분해가 쓰고 아무도 바꾸지 않는다) 실제 진행 상태는 `wp_state_log` 에만
 * 있다 — 기본 술어로 판정하면 항상 공집합이라 병합이 무의미해진다(`dispatch.ts` 가 `isDone` 을
 * `doneSet` 으로 갈아끼우는 것과 같은 구조).
 *
 * **병합 결과를 다시 검증한다.** 두 그래프가 각각 비순환이어도 합집합은 순환일 수 있다
 * (기존 `a→b` · incoming `b→a`). 사이클 검사는 incoming 에만 걸려 있었으므로 여기서 한 번 더 건다.
 */
async function mergeWithInflight(
  workflowId: string, incoming: WorkPackage[], deps: DecompositionDeps,
): Promise<MergeResult> {
  // 읽기 실패(DB 다운·저장 JSON 손상)는 **삼키지 않고 전파한다.** 여기서 inconsistent 로 바꾸면
  // 소비자가 메시지를 ack 해 분해가 영영 사라진다 — `structural` 은 DAG 모양이 틀렸다는 의미
  // 범주이지 전송·저장 오류가 아니다. upsertGraph 실패를 전파하는 것과 같은 계약이고,
  // 전파해도 upsertGraph 이전이라 쓰기는 일어나지 않는다(fail-closed 는 그대로).
  const existing = await deps.repo.getGraph(workflowId)
  if (!existing || existing.workPackages.length === 0) return { ok: true, workPackages: incoming, storedIntent: existing?.intent ?? null }

  const states = await deps.repo.latestStates(workflowId)
  const merged = mergeKeepInflight(existing.workPackages, incoming, {
    isInflight: (w) => {
      const s = states.get(w.id)?.toState
      return s !== undefined && WP_INFLIGHT_STATES.has(s as WpStatus)
    },
  })

  try {
    const cycles = detectCycle(buildTaskGraph(merged))
    if (cycles.length > 0) {
      return { ok: false, reason: 'cycle', detail: `재진입 병합 결과가 순환이다: ${cycles.map((c) => c.join('→')).join(' | ')}` }
    }
  } catch (e) {
    return { ok: false, reason: 'structural', detail: `재진입 병합 결과가 구조적으로 무효다: ${(e as Error).message}` }
  }
  return { ok: true, workPackages: merged, storedIntent: existing.intent }
}

/** 결정론 소비 핸들러: build → (구조오류|사이클 → inconsistent 발행) | (병합 → upsert). LLM 호출 0. */
export async function handleDecompositionEmitted(
  msg: DecompositionEmittedMessage,
  deps: DecompositionDeps,
): Promise<DecompositionOutcome> {
  const workflowId = msg.envelope.workflowId
  const wps = msg.payload.workPackages
  let graph: TaskGraph
  try {
    graph = buildTaskGraph(wps)
  } catch (e) {
    const detail = (e as Error).message
    await emitInconsistent(msg, deps, 'structural', { detail })
    await surfaceInconsistent(msg, deps, 'structural', detail)
    return { status: 'inconsistent', reason: 'structural' }
  }
  const cycles = detectCycle(graph)
  if (cycles.length > 0) {
    await emitInconsistent(msg, deps, 'cycle', { cycles })
    await surfaceInconsistent(msg, deps, 'cycle')
    return { status: 'inconsistent', reason: 'cycle' }
  }
  // S6.2 재진입 병합 — 재분해가 진행 중 WP 를 통째로 덮어쓰던 것(F1)을 막는다.
  // 실패 시 영속하지 않고 사람에게 올린다(fail-closed): 무엇이 진행 중인지 모르는 채로 쓰면
  // 그것이 정확히 이 슬라이스가 막으려는 결함이다.
  const merged = await mergeWithInflight(workflowId, wps, deps)
  if (!merged.ok) {
    await emitInconsistent(msg, deps, merged.reason, { detail: merged.detail })
    await surfaceInconsistent(msg, deps, merged.reason, merged.detail)
    return { status: 'inconsistent', reason: merged.reason }
  }

  const { version } = await deps.repo.upsertGraph({
    workflowId,
    workPackages: merged.workPackages,
    eventId: msg.envelope.eventId,
    // P4a-2: 워크스페이스 컨텍스트를 그래프와 함께 영속(미존재 시 null — 워커가 placeholder 폴백).
    userContext: msg.payload.userContext ?? null,
    // S7.2: `upsertGraph` 는 graph_dag 를 통째로 교체하므로 새 발행에 intent 가 없으면 **유실**된다.
    // 재분해 발행이 intent 를 안 실어도 원 스펙이 남아 있어야 다음 `spec_fix` 가 돌 수 있다 —
    // 병합 때문에 이미 읽어 둔 `existing` 에서 이월한다(추가 조회 0).
    intent: msg.payload.intent ?? merged.storedIntent ?? null,
  })
  // P3-2: 초안 오라클 pending 영속(멱등 upsertDraft). oracleId는 repo가 workflowId로 파생(D2 — 단일 출처).
  // 미주입/빈 배열이면 skip(회귀 0). upsertGraph 성공 후에만 — 영속 실패 시 오라클 미적재.
  if (deps.oracleStore && msg.payload.oracleDrafts.length > 0) {
    for (const d of msg.payload.oracleDrafts) {
      await deps.oracleStore.upsertDraft({
        workflowId,
        storyId: d.storyId,
        scenarios: d.scenarios,
        coverage: d.coverage,
        invariants: d.invariants,
        tenantId: msg.payload.userContext?.tenantId ?? null,
      })
    }
  }
  // C3: draft 영속 후 oracle_approval DecisionRequest 발행(per-workflow). best-effort never-throw.
  if (deps.oracleStore && deps.decisionStore && msg.payload.oracleDrafts.length > 0) {
    try {
      await deps.decisionStore.createRequest({
        ...buildOracleBrief({
          workflowId,
          projectId: msg.payload.userContext?.projectId ?? null,
          storyCount: msg.payload.oracleDrafts.length,
        }),
        tenantId: msg.payload.userContext?.tenantId ?? null,
      })
    } catch (err) {
      console.warn('[decomposition] oracle_approval 발행 실패(best-effort·영속은 완료):', err)
    }
  }
  return { status: 'persisted', version }
}

/**
 * 소비 핸들러 빌더: handleDecompositionEmitted(영속/에스컬레이션) → 영속 성공 시 afterPersisted(workflowId).
 * afterPersisted=디스패치를 주입하면 소비→영속→디스패치를 합성한다(P1d-7 Supervisor). 미전달이면 영속만(P1d-2).
 */
export function buildDecompositionConsumerHandler(
  repo: TaskGraphRepo,
  publish: Publish,
  afterPersisted?: (workflowId: string) => Promise<void>,
  oracleStore?: DecompositionDeps['oracleStore'],
  decisionStore?: DecompositionDeps['decisionStore'],
  notifyUser?: DecompositionDeps['notifyUser'],
  failureDecisionStore?: DecompositionDeps['failureDecisionStore'],
): (msg: DecompositionEmittedMessage) => Promise<void> {
  return async (msg) => {
    const outcome = await handleDecompositionEmitted(msg, {
      repo, publish,
      ...(oracleStore && { oracleStore }),
      ...(decisionStore && { decisionStore }),
      ...(notifyUser && { notifyUser }),
      ...(failureDecisionStore && { failureDecisionStore }),
    })
    if (outcome.status === 'persisted' && afterPersisted) {
      await afterPersisted(msg.envelope.workflowId)
    }
  }
}

/** decomposition.emitted 소비자(전송 글루). 도메인 로직은 handleDecompositionEmitted에 위임. */
export class DecompositionConsumer extends BaseConsumer<DecompositionEmittedMessage> {
  constructor(
    redis: Redis, repo: TaskGraphRepo, publish: Publish,
    sleep?: (ms: number) => Promise<void>,
    afterPersisted?: (workflowId: string) => Promise<void>,
    oracleStore?: DecompositionDeps['oracleStore'],
    decisionStore?: DecompositionDeps['decisionStore'],
    notifyUser?: DecompositionDeps['notifyUser'],
    failureDecisionStore?: DecompositionDeps['failureDecisionStore'],
  ) {
    super(
      redis,
      buildDecompositionConsumerHandler(repo, publish, afterPersisted, oracleStore, decisionStore, notifyUser, failureDecisionStore),
      CONSUMER_GROUP,
      `manager-taskgraph-${process.pid}`,
      STREAM_PREFIX,
      // WorkPackageSchema의 .default() 필드 때문에 입력 타입(부분)과 출력 타입(DecompositionEmittedMessage)이
      // 어긋난다. safeParse는 런타임에 default를 적용해 정확히 출력 타입을 만들므로 출력 타입으로 좁힌다(형제 ToolHandler 관례).
      DecompositionEmittedSchema as ZodType<DecompositionEmittedMessage>,
      sleep,
    )
  }
}
