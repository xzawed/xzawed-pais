# P1d-4 디스패치 (readyNodes → wp.dispatched · step-N · 상태전이 로깅) 설계

- 날짜: 2026-06-08
- 서비스: `xzawedManager`(packages/server)
- 로드맵: senario ROADMAP Phase 1 — **P1d 결정론적 Task Manager**의 네 번째 슬라이스(4/7). P1d-1 Core(#253)·P1d-3 영속(#255)·P1d-2 소비(#256) 다음.

## 1. 목표 & 비범위

영속된 WP 그래프에서 **ready 노드를 결정론적으로 디스패치**한다: `readyNodes`로 디스패치 대상 산출 → 각 WP에 **step-N**(결정론 위상 인덱스) 부여 → **단일 트랜잭션으로** `wp.dispatched` 도메인 이벤트(`manager_events`) + 상태전이(`wp_state_log` DRAFTED→DISPATCHED) + 아웃박스(`manager_outbox`)를 적재한다(M5 트랜잭셔널 아웃박스). 기존 `OutboxRelay`가 미발행 아웃박스를 `manager:events:{workflowId}`로 at-least-once 발행한다. Task Manager는 **결정론 유지**(LLM 호출 0).

**설계 근거(사양 §6·N4)**: "결정론 경계 — 위상정렬·안정 ID·병합은 순수 코드, LLM은 의미 판단(수선)에만." step-N은 `topoSort(graph).order`의 위치(결정론·입력 순서 무관)로, 같은 그래프 → 같은 step → 같은 멱등키 → replay/재전달 안전(N4).

**범위(이 슬라이스)**:
- `src/streams/dispatch.ts` — 순수 플래너 `planDispatch` + 오케스트레이션 `handleDispatch`.
- `src/db/dispatch.repo.ts` — `DispatchStore.recordDispatch`(단일 tx 3-INSERT 원자 적재, M5).
- 유닛 + skip-if-no-DB 통합 테스트.

**비범위(후속 슬라이스, 엄격 제외)**: **server.ts 런타임 배선·트리거 구독**(P2 생산자 `decomposition.emitted`/`wp.completed` 생명주기 또는 P1d-5 Supervisor 도착 시)·**wp.completed 재평가 흐름**(완료가 후행 노드를 unblock하는 루프)·**실제 에이전트 디스패치**(wp.dispatched → tool-calling 연결)·**lease/escalation**(P1d-5)·**done/blocked 등 잔여 상태머신**(WORKFLOW §B 8+2 전체)·**wp_state_log CHECK 제약**(상태머신 미확정이라 TEXT 전방호환 유지). **기존 코드 0줄 수정** — 신규 파일 + 테스트만. 마이그레이션 불요(007 `wp_state_log`·006 `manager_events`/`manager_outbox` 재사용).

## 2. 설계 결정 (PO 승인)

1. **슬라이스 = 순수 디스패치 코어 + 테스트, 미배선** [PO 결정]. 생산자(decomposition.emitted=P2)·트리거(graph 영속 후 또는 wp.completed)·구독 생명주기가 아직 없음. P1d-2/P1d-3과 동일 additive 스타일(기존 코드 0줄). 트리거 배선은 P2/P1d-5 도착 시.
2. **디스패치 상태명 = DRAFTED → DISPATCHED** [PO 결정]. WORKFLOW §B 상태머신(별도 private repo) 정본 명칭. `wp_state_log`는 TEXT(CHECK 없음)라 전방호환. 디스패치 전이의 `from_state`는 초기 논리 상태 `'DRAFTED'`로 기록(007 마이그레이션의 "최초 전이 NULL" 가정을 P1d-4가 자기서술적 DRAFTED로 구체화 — TEXT라 충돌 없음). 잔여 상태(done/blocked 등)는 후속.
3. **원자성 = 트랜잭셔널 아웃박스(단일 tx)** [PO 결정]. `manager_outbox.event_id`가 `manager_events(event_id)`에 **하드 FK**(006)이므로 `wp.dispatched`는 반드시 `manager_events`에도 적재된다(M5 정석). 한 tx로 ① manager_events ② wp_state_log ③ manager_outbox INSERT. `EventStore.appendSessionEvent`(P0)와 동일 메커니즘.
4. **step-N = topoSort.order 인덱스** [PO 결정]. step-N = `topoSort(graph).order.indexOf(wpId)`. 봉투 `stepId = 'step-${N}'` → 멱등키 `{workflowId}:step-${N}:0`. 결정론(타이브레이크 id 사전순)이라 재실행/재전달에 안정.
5. **store 소유권 = 신규 `DispatchStore`** [설계 결정]. 원자 쓰기가 `wp_state_log`(TaskGraphRepo 소유)+`manager_events`/`manager_outbox`(EventStore 소유)를 가로질러, 교차 도메인 원자 쓰기를 단일 책임 신규 store로 분리. TaskGraphRepo("thin·단일 책임", P1d-3 명시)·EventStore 모두 **0줄 수정**. manager_events INSERT SQL이 EventStore와 일부 중첩되나 이벤트 shape(SessionEventType vs `wp.dispatched`)가 달라 수용(공통 저수준 헬퍼 추출은 EventStore 수정을 요해 범위 외).
6. **디스패치 멱등 = latestStates 기반 필터** [설계 결정]. 이미 `DISPATCHED`인 WP는 `alreadyDispatched`로 재디스패치 제외. 크래시로 배치 일부만 적재돼도 재실행 시 latestStates가 진행분을 건너뜀(resumable, per-WP tx).

## 3. 스트림·표 (재사용 — 신규 없음)

- **이벤트 적재**: `manager_events`(진실원천)·`manager_outbox`(M5)·`wp_state_log`(전이 로그) — 단일 tx.
- **발행(out)**: `manager:events:{workflowId}` — 기존 `OutboxRelay` 폴링이 발행(무수정). 입력 스트림(`manager:decomposition`)과 분리 → 자기소비 루프 없음.
- **session_id 규약**: `manager_events.session_id`(NOT NULL) = `workflowId`. correlationId = workflowId(EventStore 선례: sessionId=workflowId=correlationId).

## 4. API

### 4.1 순수 플래너 (`src/streams/dispatch.ts`)

```ts
import { buildTaskGraph, readyNodes, topoSort } from '@xzawed/agent-streams'
import type { TaskGraph, ReadinessOptions } from '@xzawed/agent-streams'

export interface DispatchPlanItem {
  wpId: string
  /** topoSort.order 인덱스(결정론). 봉투 stepId='step-${stepN}'. */
  stepN: number
  /** 전이 from_state(초기=DRAFTED). */
  fromState: string
}

export interface PlanDispatchOptions {
  /** 이미 디스패치된(또는 그 이후 상태) wp_id 집합 — 재디스패치 제외. */
  alreadyDispatched?: ReadonlySet<string>
  /** DoR done/oracle 판정 주입(코어 readyNodes로 전달). */
  readiness?: ReadinessOptions
}

/**
 * 디스패치 계획(순수): readyNodes ∩ !alreadyDispatched, topo 인덱스로 step-N 부여.
 * I/O·부수효과 0. order는 topoSort(graph).order(결정론).
 */
export function planDispatch(graph: TaskGraph, opts?: PlanDispatchOptions): DispatchPlanItem[]
```

로직:
```ts
const already = opts?.alreadyDispatched ?? new Set()
const order = topoSort(graph).order
const ready = readyNodes(graph, opts?.readiness)
return ready
  .filter((id) => !already.has(id))
  .map((id) => ({ wpId: id, stepN: order.indexOf(id), fromState: DRAFTED_STATE }))
```
- `readyNodes`가 이미 topo 순서로 반환하므로 결과도 결정론 순서.
- 상태명 비의존: `alreadyDispatched`는 호출자가 latestStates에서 파생 → 플래너는 'DISPATCHED' 문자열을 모름(DRAFTED_STATE from_state 상수만 사용).

### 4.2 오케스트레이션 (`src/streams/dispatch.ts`)

```ts
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { DispatchStore } from '../db/dispatch.repo.js'

export interface DispatchDeps {
  repo: TaskGraphRepo
  store: DispatchStore
  now?: () => number
}

export interface DispatchOutcome {
  status: 'dispatched' | 'noop'
  dispatched: Array<{ wpId: string; stepN: number; eventId: string }>
  skipped: number  // alreadyDispatched로 제외된 ready 노드 수
}

/** 그래프 로드 → 상태 로드 → planDispatch → 항목별 원자 recordDispatch. handleDecompositionEmitted 대칭. */
export async function handleDispatch(workflowId: string, deps: DispatchDeps): Promise<DispatchOutcome>
```

로직:
1. `stored = repo.getGraph(workflowId)`; 없으면 `{ status:'noop', dispatched:[], skipped:0 }`.
2. `graph = buildTaskGraph(stored.workPackages)`.
3. `states = repo.latestStates(workflowId)`; `alreadyDispatched = {wpId | states.get(wpId).toState === DISPATCHED_STATE}`.
4. `plan = planDispatch(graph, { alreadyDispatched })`.
5. 각 item: `{ eventId } = store.recordDispatch({ workflowId, wpId, stepN, fromState, causationId: stored.eventId ?? null })`.
6. `skipped` = `readyNodes ∩ alreadyDispatched` 크기. `status`: `getGraph` null이면 `'noop'`, 그 외엔 `'dispatched'`(`dispatched` 배열은 비어 있을 수 있음 — ready 전부 이미 디스패치 또는 ready 없음). status는 "그래프 평가 여부"만 구분(noop=그래프 없음).

> 사이클/구조오류는 P1d-2가 영속 전에 걸러내므로(`getGraph`는 정상 그래프만 보유) `buildTaskGraph` throw는 불변식 위반 — 발생 시 throw 전파(BaseConsumer 재시도/배선 시). 방어적으로 try 없이 둠(영속 계약 신뢰).

### 4.3 원자 적재 (`src/db/dispatch.repo.ts`)

```ts
import type { Pool, PoolClient } from 'pg'
import { makeEnvelope } from '@xzawed/agent-streams'

export interface RecordDispatchInput {
  workflowId: string
  wpId: string
  stepN: number
  fromState: string
  toState?: string          // 기본 'DISPATCHED'
  causationId?: string | null
  reason?: string | null
}
export interface RecordDispatchResult { eventId: string; seq: number }

/** WP 디스패치 원자 적재 — manager_events + wp_state_log + manager_outbox 단일 tx(M5). */
export class DispatchStore {
  constructor(pool: Pool, now?: () => number)
  recordDispatch(input: RecordDispatchInput): Promise<RecordDispatchResult>
}
```

`recordDispatch` 로직:
```ts
const env = makeEnvelope(
  { correlationId: workflowId, causationId: causationId ?? null,
    workflowId, stepId: `step-${stepN}`, attemptId: 0 },
  this.now(),
)
const payload = { wpId, stepN }
const message = { envelope: env, type: 'wp.dispatched', payload }
const stream = `manager:events:${workflowId}`
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query(`INSERT INTO manager_events (event_id, session_id, event_type, payload,
      correlation_id, causation_id, idempotency_key, actor, occurred_at) VALUES ($1..$9)`,
    [env.eventId, workflowId, 'wp.dispatched', JSON.stringify(payload),
     env.correlationId, env.causationId, env.idempotencyKey, 'task-manager', env.occurredAt])
  const { rows } = await client.query(`INSERT INTO wp_state_log (workflow_id, wp_id, from_state,
      to_state, event_id, reason, occurred_at) VALUES ($1..$7) RETURNING seq`,
    [workflowId, wpId, fromState, toState ?? 'DISPATCHED', env.eventId, reason ?? null, env.occurredAt])
  await client.query(`INSERT INTO manager_outbox (event_id, stream, message) VALUES ($1,$2,$3)`,
    [env.eventId, stream, JSON.stringify(message)])
  await client.query('COMMIT')
  return { eventId: env.eventId, seq: Number(rows[0].seq) }
} catch (err) { await client.query('ROLLBACK'); throw err }
finally { client.release() }
```
- `occurred_at`은 봉투의 `occurredAt`을 세 표가 공유(단일 시각 일관성).
- 상태 상수: `DRAFTED_STATE='DRAFTED'`·`DISPATCHED_STATE='DISPATCHED'`·`EVENT_TYPE='wp.dispatched'`·`ACTOR='task-manager'`는 dispatch.ts/dispatch.repo.ts 모듈 상수(contract-drift 회피: 한 곳 정의·import).

## 5. 에러·복원력·결정론

- **그래프 없음** → noop(에러 아님). **이미 디스패치** → planDispatch가 제외(멱등).
- **부분 적재 크래시**: per-WP tx라 적재 완료분만 보존, 재실행 시 latestStates로 진행분 skip(resumable).
- **tx 실패** → ROLLBACK + throw 전파(배선 시 BaseConsumer 바운드 재시도/DLQ). FK 위반(잘못된 event_id)·연결 실패 모두 tx로 원자 롤백.
- **at-least-once 발행**: 기존 OutboxRelay(무수정). 봉투 멱등키 `{wf}:step-N:0` 결정론 → 다운스트림 M6 dedup으로 effective-exactly-once.
- **결정론**: 같은 그래프+같은 alreadyDispatched → 같은 plan(step-N·순서). topoSort 타이브레이크 id 사전순.

## 6. 테스트 (TDD)

- **유닛 `src/streams/dispatch.test.ts`**:
  - `planDispatch` 순수: 선형(A→B→C, A만 ready) ready+step-N 정확; 분기 결정론 순서; `alreadyDispatched` 제외; 빈 ready → []; `readiness` 주입(isDone/oracle) 반영; cyclic 노드 제외(readyNodes 경유).
  - `handleDispatch`(mock repo + mock store): getGraph null → noop·store 미호출; 정상 → 각 ready WP에 `store.recordDispatch` 호출(workflowId·wpId·stepN·fromState·causationId 정확); 이미 DISPATCHED는 skipped 카운트·recordDispatch 미호출; dispatched 결과 매핑(eventId 전파).
- **유닛 `src/db/dispatch.repo.test.ts`**(mock pool/client): BEGIN→3 INSERT(파라미터·순서·event_id 공유·occurred_at 봉투 일치)→COMMIT; INSERT 실패 시 ROLLBACK+throw+client.release; 봉투 stepId/idempotencyKey 형태; toState 기본 'DISPATCHED'·override.
- **통합 `test/dispatch.integration.test.ts`**(`DATABASE_URL` 없으면 `describe.skip`, 실 pg):
  - 선이수: `TaskGraphRepo.upsertGraph`로 acyclic 그래프 영속 → `handleDispatch` → ready WP에 대해 `wp_state_log`(DRAFTED→DISPATCHED·event_id)·`manager_events`(wp.dispatched)·`manager_outbox`(stream·message) 행 존재 + `latestStates` DISPATCHED 반영.
  - 멱등: 같은 workflow 재 `handleDispatch` → 이미 DISPATCHED skip(중복 행 없음).
  - 원자성: recordDispatch 후 세 표 행 수 일치(부분 적재 없음).

## 7. 회귀·검증

기존 코드 0줄 수정 → 회귀 0(신규 파일 + 테스트만, server.ts 무배선). `cd xzawedManager && pnpm build && pnpm test`(395 → 유닛 증가, 통합 +조건부 skip). `pnpm audit` 0. CPD `npx jscpd@3.5.10 --config .jscpd.json`(manager_events INSERT 중첩 주시 — 헬퍼 없이 두되 임계 초과 시 NOSONAR/추출 검토). 적대적 리뷰(원자성·롤백·멱등·결정론 step-N·상태명 비의존 플래너·스트림 루프 없음·FK 정합). PR → CI(module-boundaries) 그린 → squash 머지. CLAUDE.md(xzawedManager 구조·P1d-4 섹션)·루트 CLAUDE.md(Manager 행)·HANDOFF·메모리 갱신. **다음 P1d-5 lease/escalation**(디스패치된 WP의 임대·타임아웃·재할당). 잔여 P1d: 5→6→7.
