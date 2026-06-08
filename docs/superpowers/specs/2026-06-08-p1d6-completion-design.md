# P1d-6 wp.completed 완료 흐름 (lease release · 후행 unblock 재디스패치) 설계

- 날짜: 2026-06-08
- 서비스: `xzawedManager`(packages/server)
- 로드맵: senario ROADMAP Phase 1 — **P1d 결정론적 Task Manager**의 여섯 번째 슬라이스(6/7). P1d-5(lease, #259·#260) 다음.

## 1. 목표 & 비범위

WP 완료 시 **lease를 release하고 완료 전이(DISPATCHED→DONE)를 원자 기록**한 뒤, **완료를 done-set에 반영해 후행 노드를 unblock·재디스패치**한다. 이로써 디스패치 루프(dispatch → lease → complete → re-dispatch unblocked)가 닫힌다. Task Manager는 **결정론 유지**(LLM 0).

**범위**: `recordCompletion`(LeaseStore) + `handleCompletion`(streams/completion.ts) + **`handleDispatch` 수정**(DoR done 판정을 `latestStates`의 to_state='DONE'에서 파생). 미배선 코어 + 테스트.

**비범위(후속, 엄격 제외)**: **실제 완료 이벤트 수신·server.ts 배선**(생산자/워커 완료 신호 도착 시)·**sweep 타이머**(P1d-5b 후속)·**완료 산출물/oracle 검증**(P3)·**WORKFLOW §B 잔여 상태(blocked 등)**·CHECK 제약. 미배선(트리거 없음).

## 2. 설계 결정 (PO 승인)

1. **완료 상태 = DISPATCHED→DONE / lease released / wp.completed** [PO]. wp_state_log to_state='DONE', 이벤트 'wp.completed', lease status='released'(migration 008 status enum과 정합).
2. **후행 unblock = handleDispatch 재사용 + done-set은 latestStates 파생** [PO]. `handleCompletion`이 recordCompletion 후 `handleDispatch` 호출. **handleDispatch 수정**: DoR done 판정을 정적 graph_dag `status` 대신 `latestStates`의 `to_state='DONE'`에서 파생 → 완료가 실제로 후행을 unblock. DRY·결정론 유지.
3. **완료 가드 = active lease만** [PO]. recordCompletion UPDATE `WHERE status='active'` — 디스패치되어 active lease인 WP만 완료. 0행(이미 완료·released·escalated·미디스패치)이면 `{status:'skipped'}`. 동시 완료도 직렬화(status 단방향 active→released).
4. **슬라이스 = 미배선 코어 + 테스트** [PO]. 실제 완료 신호·server.ts 배선은 후속.

## 3. 컴포넌트

### 3.1 상수 (`streams/dispatch-constants.ts` 확장)
`DONE_STATE='DONE'`·`WP_COMPLETED_EVENT='wp.completed'`·`LEASE_RELEASED='released'` 추가(단일출처).

### 3.2 `recordCompletion` (`db/lease.repo.ts` LeaseStore)

```ts
export interface CompleteInput { workflowId: string; wpId: string; attempt: number; stepN: number; causationId?: string | null }
export type CompleteResult = { status: 'completed'; eventId: string; seq: number } | { status: 'skipped' }

recordCompletion(input: CompleteInput): Promise<CompleteResult>
```
- 기존 `transition()` 헬퍼 재사용(recordEscalation과 동형): 단일 tx — `UPDATE wp_leases SET status='released', updated_at=NOW() WHERE workflow_id=$ AND wp_id=$ AND status='active' RETURNING wp_id`(active 가드·동시 완료 직렬화) → 0행이면 skip → `appendWpEvent`(wp.completed, DISPATCHED→DONE, attempt, stepN, reason='completed') → COMMIT.
- `attempt`·`stepN`은 호출자(handleCompletion)가 `getLease`로 읽어 전달. lease.event_id는 갱신 안 함(escalate 선례 — dispatch provenance 보존).

### 3.3 `handleCompletion` (`streams/completion.ts`)

```ts
export interface CompletionDeps { leaseStore: LeaseStore; dispatch: DispatchDeps }
export interface CompletionOutcome {
  status: 'completed' | 'skipped'
  dispatched: Array<{ wpId: string; stepN: number; eventId: string }> // 완료로 unblock된 후행
  eventId?: string
}
export async function handleCompletion(workflowId: string, wpId: string, deps: CompletionDeps): Promise<CompletionOutcome>
```
로직:
1. `lease = leaseStore.getLease(workflowId, wpId)`; 없거나 `status!=='active'`면 `{status:'skipped', dispatched:[]}`(완료할 active WP 없음).
2. `c = leaseStore.recordCompletion({ workflowId, wpId, attempt: lease.attempt, stepN: lease.stepN })`; skipped면 동일 noop.
3. **재디스패치**: `redispatch = handleDispatch(workflowId, deps.dispatch)` — 완료 WP가 done-set에 반영돼 후행 unblock.
4. `{ status:'completed', dispatched: redispatch.dispatched, eventId: c.eventId }`.

### 3.4 `handleDispatch` 수정 (`streams/dispatch.ts`)

DoR done 판정을 `latestStates`에서 파생(완료 반영). 현재 `alreadyDispatched`만 latestStates에서 파생 → **done-set·escalated 확장**:
```ts
const states = await deps.repo.latestStates(workflowId)
const alreadyDispatched = new Set<string>()  // DISPATCHED ∪ ESCALATED — 재디스패치 금지
const doneSet = new Set<string>()             // DONE — DoR done
for (const [wpId, rec] of states) {
  if (rec.toState === DISPATCHED_STATE || rec.toState === ESCALATED_STATE) alreadyDispatched.add(wpId)
  if (rec.toState === DONE_STATE) doneSet.add(wpId)
}
// 주입 isDone은 **합성**(대체 아님) — DONE 상태는 항상 done으로 유지(완료-unblock 보존). oracle은 직교.
const injectedDone = deps.readiness?.isDone
const readiness: ReadinessOptions = {
  isDone: injectedDone ? (wp) => doneSet.has(wp.id) || injectedDone(wp) : (wp) => doneSet.has(wp.id),
}
if (deps.readiness?.oracleSatisfied) readiness.oracleSatisfied = deps.readiness.oracleSatisfied
```
- `ready = readyNodes(graph, readiness)` / `planDispatch(graph, { alreadyDispatched, readiness })`.
- **회귀 안전**: 완료(DONE) 상태가 없는 기존 테스트는 doneSet 비어 isDone=false → 동작 불변(이전 기본 `wp.status==='done'`도 draft라 false).

## 4. 데이터 흐름
WP X 완료 → recordCompletion(lease released·X→DONE) → handleDispatch(latestStates에 X=DONE 반영 → X의 후행이 ready → dispatch). 모든 쓰기 단일 tx(M5)·OutboxRelay 발행.

## 5. 멱등·복원력·결정론
- **완료 멱등**: active 가드(status='active'→'released' 단방향). 이미 완료/released면 0행 skip. 동시 완료 직렬화.
- **재디스패치 멱등**: handleDispatch의 alreadyDispatched(DISPATCHED∪ESCALATED) + lease PK dedup(§8 #2). 완료된 X는 doneSet이라 재디스패치 안 됨(readyNodes가 done 제외).
- **결정론**: planDispatch 순수. done-set은 latestStates(결정론 스냅샷).

## 6. 테스트 (TDD)
- **`lease.repo.test.ts`** +recordCompletion(mock): tx UPDATE status='released' WHERE status='active' + appendWpEvent(wp.completed·DISPATCHED→DONE)·멱등키·0행 skip·ROLLBACK 가드.
- **`completion.test.ts`**(mock leaseStore + mock dispatch): getLease null/비active → skip·recordCompletion 미호출; active → recordCompletion 호출(attempt/stepN 전달)·이어서 handleDispatch 호출·dispatched 매핑; recordCompletion skipped → 재디스패치 안 함.
- **`dispatch.test.ts`** +handleDispatch: latestStates에 dep가 DONE이면 후행이 ready로 디스패치; ESCALATED는 alreadyDispatched로 제외; 기존 테스트 회귀 0.
- **통합 `completion.integration.test.ts`**(skip-if-no-DB): 그래프 a→b 영속·dispatch a → handleCompletion(wf,'a') → a lease released·a DONE·b 재디스패치(b lease active)·b의 wp.dispatched. `'wf-comp-%'` 스코프 cleanup + beforeAll 선삭제.

## 7. 회귀·검증
handleDispatch 수정(기존 테스트 회귀 0 확인)·LeaseStore +recordCompletion·신규 completion.ts. `cd xzawedManager && pnpm build && pnpm test`. audit·CPD(transition·appendWpEvent 재사용). 적대적 리뷰(완료 가드·done-set 파생·재디스패치 멱등·동시 완료 직렬화·회귀). PR → CI 그린 → squash. CLAUDE.md·메모리 갱신. **다음 P1d-7**(P1d 마지막: 잔여 범위 PO 확인 — 유력 Supervisor 런타임 배선).

## 8. 알려진 한계 (배선 슬라이스 P1d-7에서 해소)

적대적 리뷰(4확정 low)에서 도출된, **미배선이라 현재 미발현이나 배선(소비자/Supervisor) 전 해소**할 잠복 항목.

1. **WP 생명주기 이벤트가 attempt 멱등키를 공유** [리뷰 low·P1d-5b 선례]. `wp.dispatched`·`wp.completed`·`wp.escalated`는 모두 봉투 stepId=`wp-${wpId}`·attemptId=attempt로 멱등키 `{wf}:wp-${wpId}:${attempt}`를 만든다 → **같은 (wpId, attempt)면 이벤트 타입이 달라도 멱등키가 동일**. 모두 `manager:events:{wf}`로 발행되므로, P1d-7에서 이 스트림을 BaseConsumer M6 dedup(`SET idem:{stream}:{key} NX`)으로 소비하면 `wp.completed`가 앞선 `wp.dispatched`의 중복으로 판정돼 skip될 수 있다(manager_events.idempotency_key UNIQUE 아님 — DB는 막지 않음). **해소(배선 전)**: 멱등키에 이벤트 타입 포함(예 stepId=`wp-${wpId}:${eventType}`) 또는 `manager:events` 소비자 dedup을 `event_id` 기반으로. wp.dispatched 자체 멱등(재디스패치 attempt별)은 유지.
2. **recordCompletion의 stale attempt(TOCTOU)** [리뷰 low·provenance만]. `handleCompletion`이 `getLease`로 읽은 attempt를 전달하고 recordCompletion은 attempt CAS 없이 active만 가드 → getLease 후 동시 reclaim 시 이벤트 attempt가 stale일 수 있다(상태 전이는 정확, provenance만 부정확). active→released 단방향이 완료를 직렬화해 중복·이중 DONE은 없다. attempt CAS를 넣으면 reclaim 직후 '진짜 끝낸' 완료를 무시할 위험이라 **의도적 미적용** — P1d-7 동시 sweep 배선 시 재검토(예: tx 내 UPDATE…RETURNING attempt로 재독).
