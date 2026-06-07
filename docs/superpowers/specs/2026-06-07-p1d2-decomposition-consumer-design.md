# P1d-2 decomposition.emitted 소비 (결정론 Task Graph 빌드·영속) 설계

- 날짜: 2026-06-07
- 서비스: `xzawedManager`(packages/server)
- 로드맵: senario ROADMAP Phase 1 — **P1d 결정론적 Task Manager**의 세 번째 슬라이스(3/7). P1d-1 Core(#253)·P1d-3 영속(#255) 다음.

## 1. 목표 & 비범위

`decomposition.emitted`(PM이 emit한 WP DAG)를 소비해 → `buildTaskGraph`로 빌드 → **비순환이면** `TaskGraphRepo.upsertGraph`로 영속, **사이클/구조오류면** `decomposition.inconsistent` 발행으로 **에스컬레이션**한다. Task Manager는 **결정론 유지**(LLM 호출 0).

**설계 근거(사양 §6)**: "결정론 경계 — 매트릭스·갭/중복·사이클검사·위상정렬·안정 ID·병합은 순수 코드, **LLM은 의미 판단(수선)에만**." `llm_break_cycle`은 PM 분해 파이프라인(P2) 안에서 `emit(g)` *전에* 수행되므로 Task Manager가 받는 그래프는 정상적으로 비순환이며, 사이클은 분해 오류 신호다. 충돌 시 사양 우선 규칙에 따라 HANDOFF의 "llm_break_cycle은 P1d-2 책임" 노트보다 사양 §6을 따른다(PO 승인).

**범위(이 슬라이스)**:
- `src/streams/decomposition-consumer.ts` — 메시지 스키마 + 순수 핸들러 `handleDecompositionEmitted` + thin `DecompositionConsumer`(BaseConsumer 서브클래스).
- 유닛 + skip-if-no-DB 통합 테스트.

**비범위(후속, 엄격 제외)**: `llm_break_cycle`(LLM 수선 — PM/P2)·`wp.dispatched` 발행·step-N 부여(P1d-4)·lease(P1d-5)·**server.ts 런타임 배선**(생산자 P2·per-workflow 구독 생명주기 도착 시)·**WP 상태전이(DRAFTED→…) wp_state_log 로깅(P1d-4 디스패치 책임)**. 기존 코드 0줄 수정(신규 파일 + 테스트만).

## 2. 설계 결정 (PO 승인)

1. **사이클/구조오류 = 결정론 에스컬레이션** [PO 결정]. detectCycle 양성 또는 buildTaskGraph throw(중복 id·dangling dep) → `decomposition.inconsistent` 발행 + 영속 안 함. LLM 수선 없음(PM/P2 또는 사람 책임). WORKFLOW §A `DECOMPOSING --decomposition.inconsistent--> AWAITING_HUMAN`와 정합.
2. **소비자 코어 + 테스트, 런타임 배선 보류** [PO 결정]. 생산자(decomposition.emitted)가 아직 없음(PM 분해=P2). per-workflow 구독 시작/중지 생명주기는 생산자·Supervisor(P1d-4/5) 도착 시. P1d-3과 동일 additive 스타일.
3. **전송과 로직 분리**. 순수 핸들러 `handleDecompositionEmitted(msg, deps)`가 도메인 로직(빌드·분기·영속·에스컬레이션)을 담당하고 유닛 테스트 표적. `DecompositionConsumer`는 BaseConsumer에 핸들러를 바인딩하는 thin 전송 글루.
4. **상태전이 로깅은 P1d-4로 보류**. 재분해 시 중복 DRAFTED 기록·idempotency 복잡도 회피. P1d-2는 그래프 영속까지만. wp_state_log(#255)는 디스패치 단계가 채운다.
5. **멱등 소비 ON**(#246). dedup 키 = `envelope.idempotencyKey`(BaseConsumer 기본). 동일 decomposition.emitted 재전달 skip. 재분해(새 eventId)는 새 이벤트 → `upsertGraph` version++.

## 3. 스트림 (잠정 — P2 배선 시 확정·문서화)

- **입력 consume**: `manager:decomposition:{workflowId}` (streamPrefix=`manager:decomposition`, group=`manager-taskgraph-consumers`). 세션 이벤트 스트림(`manager:events`)과 **분리** → 단일 literal 스키마 충돌·자기소비 루프 회피.
- **출력 inconsistent**: `manager:events:{workflowId}` (워크플로 이벤트 로그; 향후 Supervisor가 소비해 사람 에스컬레이션). 입력과 다른 스트림이라 루프 없음.

> 두 스트림 키는 생산자(P2)·Supervisor 배선 시 최종 확정. 핸들러는 스트림 키를 `publish` 콜백으로 주입받아 결합도를 낮춘다.

## 4. API (`src/streams/decomposition-consumer.ts`)

```ts
import type { Redis } from 'ioredis'
import { z } from 'zod'
import {
  BaseConsumer, RedisEventBus, EventEnvelopeSchema, WorkPackageSchema,
  buildTaskGraph, detectCycle, makeEnvelope,
} from '@xzawed/agent-streams'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'

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

/** 결정론 소비 핸들러: build → (구조오류|사이클 → inconsistent 발행) | (정상 → upsert). */
export async function handleDecompositionEmitted(
  msg: DecompositionEmittedMessage,
  deps: DecompositionDeps,
): Promise<DecompositionOutcome>

export class DecompositionConsumer extends BaseConsumer<DecompositionEmittedMessage> {
  constructor(redis: Redis, repo: TaskGraphRepo, publish: Publish, sleep?: (ms: number) => Promise<void>)
}
```

**핸들러 로직**:
```ts
const wfId = msg.envelope.workflowId
const wps = msg.payload.workPackages
let graph
try {
  graph = buildTaskGraph(wps)
} catch (e) {
  await emitInconsistent(deps, msg, 'structural', { detail: (e as Error).message })
  return { status: 'inconsistent', reason: 'structural' }
}
const cycles = detectCycle(graph)
if (cycles.length > 0) {
  await emitInconsistent(deps, msg, 'cycle', { cycles })
  return { status: 'inconsistent', reason: 'cycle' }
}
const { version } = await deps.repo.upsertGraph({ workflowId: wfId, workPackages: wps, eventId: msg.envelope.eventId })
return { status: 'persisted', version }
```

**`emitInconsistent`**(파일-로컬 헬퍼):
```ts
const env = makeEnvelope(
  { correlationId: msg.envelope.correlationId, causationId: msg.envelope.eventId,
    workflowId: msg.envelope.workflowId, stepId: 'decomposition.inconsistent', attemptId: 0 },
  deps.now?.(),
)
const stream = (deps.inconsistentStream ?? ((w) => `manager:events:${w}`))(msg.envelope.workflowId)
await deps.publish(stream, { envelope: env, type: 'decomposition.inconsistent', payload: { reason, ...extra } })
```

**`DecompositionConsumer`**: `super(redis, (m) => handleDecompositionEmitted(m, { repo, publish }).then(() => undefined), 'manager-taskgraph-consumers', `manager-taskgraph-${process.pid}`, 'manager:decomposition', DecompositionEmittedSchema, sleep)`. dedup은 BaseConsumer 기본(ON). `publish`는 `new RedisEventBus(redis).publish` 바인딩 주입.

## 5. 에러·복원력
- **스키마 무효** 메시지 → BaseConsumer DLQ(`:dlq`, reason:'invalid_schema'). decomposition.inconsistent(다른 type)가 입력 스트림에 안 오므로(분리 스트림) 오탐 DLQ 없음.
- **구조오류/사이클** = 도메인 결과 → `decomposition.inconsistent` 발행 후 정상 ack(DLQ 아님).
- **`upsertGraph` DB 오류** → throw 전파 → BaseConsumer 바운드 재시도(최대 maxDeliveries) → 소진 시 DLQ(handler_failed).
- **멱등**: dedup(envelope.idempotencyKey)으로 재전달 skip.

## 6. 테스트 (TDD)
- **유닛** `src/streams/decomposition-consumer.test.ts`(mock repo + mock publish 콜백):
  - happy: acyclic WP[] → `repo.upsertGraph` 호출(workflowId·eventId 정확)·publish 미호출·`{status:'persisted',version}`.
  - cycle: A↔B 의존 → detectCycle 양성 → publish 1회(stream=`manager:events:{wf}`·type `decomposition.inconsistent`·payload.reason='cycle'·cycles 포함)·upsert 미호출.
  - structural: dangling dep(또는 중복 id) → buildTaskGraph throw → publish reason='structural'·detail 포함·upsert 미호출.
  - emitInconsistent envelope: causationId=원 eventId·correlationId/workflowId 전파·stepId.
  - 클래스 생성 스모크(인스턴스화 무throw).
- **통합** `test/decomposition-consumer.integration.test.ts`(skip-if-no-DB, Redis 불요 — 핸들러 직접 호출 + 실 `TaskGraphRepo`):
  - acyclic → `handleDecompositionEmitted` → `repo.getGraph(wfId)` 영속 확인(version 1, workPackages 보존).
  - cycle → 미영속(`getGraph` null) + stub publish 호출 확인.

## 7. 회귀·검증
기존 코드 0줄 수정 → 회귀 0. `cd xzawedManager && pnpm build && pnpm test`(387 → 유닛 증가, 통합 +skip). audit·CPD. 적대적 리뷰(결정론·LLM 미결합·사이클/구조 분기 정확·스트림 루프 없음·멱등·envelope 인과). PR → CI(module-boundaries) 그린 → squash 머지. CLAUDE.md·HANDOFF·메모리 갱신. **다음 P1d-4 디스패치**(readyNodes → wp.dispatched, step-N 부여, 상태전이 로깅).
