import type { Redis } from 'ioredis'
import { z, type ZodType } from 'zod'
import {
  BaseConsumer,
  EventEnvelopeSchema,
  WorkPackageSchema,
  buildTaskGraph,
  detectCycle,
  makeEnvelope,
} from '@xzawed/agent-streams'
import type { TaskGraph } from '@xzawed/agent-streams'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'

// 단일 type 스트림(manager:decomposition:{wf})용 스키마 — 다른 type 메시지가 들어오면
// BaseConsumer가 invalid_schema로 DLQ 격리한다(의도된 동작; P1d-4가 이 스트림을 다중화하면 재검토).
export const DecompositionEmittedSchema = z.object({
  envelope: EventEnvelopeSchema,
  type: z.literal('decomposition.emitted'),
  payload: z.object({ workPackages: z.array(WorkPackageSchema) }),
})
export type DecompositionEmittedMessage = z.infer<typeof DecompositionEmittedSchema>

export type InconsistentReason = 'cycle' | 'structural'
export type Publish = (stream: string, message: Record<string, unknown>) => Promise<unknown>

export interface DecompositionDeps {
  repo: TaskGraphRepo
  publish: Publish
  /** inconsistent 출력 스트림 키 빌더(기본 manager:events:{workflowId}). */
  inconsistentStream?: (workflowId: string) => string
  now?: () => number
}

export type DecompositionOutcome =
  | { status: 'persisted'; version: number }
  | { status: 'inconsistent'; reason: InconsistentReason }

const CONSUMER_GROUP = 'manager-taskgraph-consumers'
const STREAM_PREFIX = 'manager:decomposition'
// 입력(manager:decomposition)과 의도적으로 분리된 출력 스트림(자기소비 루프 방지). 세션 이벤트소싱
// 스트림(session.store.ts)과 네임스페이스를 공유하므로, 다운스트림 소비자(P1d-4/Supervisor)는
// decomposition.inconsistent를 세션 이벤트와 함께 처리할 수 있어야 한다.
const defaultInconsistentStream = (workflowId: string): string => `manager:events:${workflowId}`

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

/** 결정론 소비 핸들러: build → (구조오류|사이클 → inconsistent 발행) | (정상 → upsert). LLM 호출 0. */
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
    await emitInconsistent(msg, deps, 'structural', { detail: (e as Error).message })
    return { status: 'inconsistent', reason: 'structural' }
  }
  const cycles = detectCycle(graph)
  if (cycles.length > 0) {
    await emitInconsistent(msg, deps, 'cycle', { cycles })
    return { status: 'inconsistent', reason: 'cycle' }
  }
  const { version } = await deps.repo.upsertGraph({
    workflowId,
    workPackages: wps,
    eventId: msg.envelope.eventId,
  })
  return { status: 'persisted', version }
}

/** decomposition.emitted 소비자(전송 글루). 도메인 로직은 handleDecompositionEmitted에 위임. */
export class DecompositionConsumer extends BaseConsumer<DecompositionEmittedMessage> {
  constructor(redis: Redis, repo: TaskGraphRepo, publish: Publish, sleep?: (ms: number) => Promise<void>) {
    super(
      redis,
      async (msg) => {
        await handleDecompositionEmitted(msg, { repo, publish })
      },
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
