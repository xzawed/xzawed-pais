# P3-1 Oracle DoR 게이트 — 디스패치 언블록 최소 슬라이스 설계

> Phase 3 첫 슬라이스. senario `xzawedPAIS_handoff_spec.md` §7(WP 계약)·§8(DoR/오라클)과 `docs/senario/ORACLE_SCHEMA.md`(v3 확정)를 구현 토대로 한다.
> 목표: P2-3 분해 파이프라인이 완성됐으나 **모든 WP가 `oracleRef=null`이라 `readyNodes=∅`·디스패치 0**인 실행 블로커를, 사람이 승인한 Oracle을 DoR 게이트에 반영해 **처음으로 `ready→dispatched`를 연다**.

## 1. 배경 — 단일 코드 사실로 좁혀진 블로커

P2-3(#266까지)로 `decompose_request → 4단계 LLM 분해 → WP DAG → decomposition.emitted → 영속 → handleDispatch`가 완성됐다. 그러나 디스패치가 0건이다. 원인이 한 줄로 좁혀진다(실측):

- [readiness.ts:14](../../../xzawedShared/src/task-graph/readiness.ts) `defaultOracleSatisfied = (wp) => wp.oracleRef != null` 이 `isReady`의 필수 가드([readiness.ts:25](../../../xzawedShared/src/task-graph/readiness.ts)).
- [map.ts:38](../../../xzawedManager/packages/server/src/decompose/map.ts) 이 **모든 WP를 `oracleRef: null`로 발행**.
- [supervisor.ts:107](../../../xzawedManager/packages/server/src/streams/supervisor.ts) `createSupervisor`가 dispatch에 readiness를 주입하지 않아 `oracleSatisfied`가 기본 술어로 떨어짐.
- → 어떤 WP도 ready가 되지 못함 → `readyNodes=∅` → dispatch 0.

[readiness.ts:9-10](../../../xzawedShared/src/task-graph/readiness.ts) 주석 자체가 *"P3 Oracle 스키마 도착 시 술어만 교체"*라고 명시한다 — 코드베이스가 지정한 해소 지점이 이 슬라이스다.

## 2. 범위 — 메커니즘 우선 단일 슬라이스 (PO 결정 2026-06-09)

디스패치 언블록(`readyNodes≠∅`)을 **한 PR**로 end-to-end 달성하되, 풀 Phase 3(effort L: step-definition 컴파일·검증 오라클·실행 에이전트)는 분할한다.

**포함**: ①Oracle 영속(Postgres) ②§8 충족 satisfied-set 순수 코어 ③디스패치 시 술어 주입 ④`oracle.approved` 이벤트→Supervisor→재디스패치 ⑤사람 작성·승인 API.

**제외(후속 슬라이스)**: LLM 시나리오 초안 생성(§10 P7) · 검증 오라클/골든 diff(Phase 4) · `oracleRef` 기입(provenance) · 정식 acceptance_criterion_id 매핑 · invariant property 테스트 컴파일(N1 step-def) · UI.

### 핵심 결정 (브레인스토밍 2026-06-09)
1. **메커니즘 우선 단일 슬라이스** — 오라클 내용은 사람 시드/수동, LLM 초안은 후속. 디스패치 언블록을 최소 코드로 증명.
2. **술어 주입(pull, satisfied-set)** — push(WP에 oracleRef 기입) 대신, 디스패치 시 approved 오라클을 조회해 satisfied-set을 산출하고 `oracleSatisfied` 술어를 주입. readiness 순수 유지 · task_graph 불변 · 오라클 상태 실시간 반영(supersede 시 stale 없음) · readiness.ts seam 그대로.
3. **이벤트 구동 재디스패치** — approve가 `oracle.approved` 이벤트를 아웃박스로 발행 → Supervisor가 completion과 동일 패턴 consumer로 구독 → handleDispatch. 이벤트소싱 일관 · route↔dispatch 디커플링 · at-least-once.

## 3. 컴포넌트 & 데이터 모델

### 3.1 Oracle 영속 (Manager)

**migration `009_oracles.sql`** — `task_graphs`와 동일한 가변 프로젝션 패턴(재승인 시 upsert):

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `oracle_id` | text PK | content/uuid id |
| `workflow_id` | text | 워크플로 바인딩 |
| `story_id` | text | Story 바인딩 (ORACLE_SCHEMA §1) |
| `version` | int | 단조 증가, 승인 시 불변 (§6) |
| `status` | text | `pending`\|`approved`\|`superseded` (§2) |
| `scenarios` | jsonb | Given-When-Then[] (§3) |
| `invariants` | jsonb | 속성[] (§4) |
| `golden_refs` | jsonb | 골든[] (§5) |
| `coverage` | jsonb | `{acceptance_criterion: [scenario_id]}` (§8) |
| `provenance` | jsonb | drafted/approved/diff/rationale (§2·M7) |
| `created_at`·`approved_at`·`approved_by` | timestamptz/text | 감사 |

인덱스: `(workflow_id, status)` — `approvedByWorkflow` 조회용.

**`db/oracle.repo.ts` `OracleRepo`**:
- `upsert(oracle)` — 생성/수정(status `pending`). ON CONFLICT version++.
- `approve(oracleId, approvedBy)` — **단일 tx**: `oracles` status=`approved`·approved_at/by 갱신 + `manager_events`(`oracle.approved`, payload `{oracleId, workflowId, storyId, version}`) + `manager_outbox`(stream=`manager:oracle:main` — Supervisor `:main` 채널 소비 모델, workflowId는 봉투). [dispatch.repo.ts](../../../xzawedManager/packages/server/src/db/dispatch.repo.ts)의 `appendWpEvent`/`recordDispatch` 트랜잭셔널 아웃박스 패턴 재사용(ROLLBACK 가드·연결 손상 시 원본 오류 보존).
- `approvedByWorkflow(workflowId): ApprovedOracle[]` — 디스패치 시 satisfied-set 계산용. status=`approved`만.

Oracle 아티팩트는 Zod 스키마(`OracleSchema`)로 검증 — ORACLE_SCHEMA §2~§5 구조.

### 3.2 satisfied-set 순수 코어 (xzawedShared)

**`task-graph/oracle-dor.ts`** — 순수 함수, I/O·DB·LLM 0:

```ts
export interface ApprovedOracleView {
  storyId: string
  /** acceptance_criterion(문자열) → 그 기준을 덮는 human_approved 시나리오 존재 여부. */
  coveredCriteria: Set<string>
}
export function oracleSatisfiedSet(
  workPackages: WorkPackage[],
  approvedOracles: ApprovedOracleView[],
): Set<string>
```

- 각 WP가 satisfied = `wp.storyId`에 바인딩된 approved 오라클 존재 ∧ `wp.acceptanceCriteria`의 **모든** 항목이 그 오라클의 `coveredCriteria`에 포함(§8: 각 acceptance_criterion을 덮는 human_approved 시나리오 ≥1).
- `coveredCriteria`는 repo→view 변환 시 산출: `coverage[ac]`의 시나리오 중 status=`human_approved`가 ≥1인 ac만 포함.
- AC 매칭: 이 슬라이스는 **AC 문자열 동일성**(coverage 키 = WP acceptanceCriteria 문자열). 정식 acceptance_criterion_id 매핑은 후속.
- 빈 acceptanceCriteria WP는 "오라클 존재 시 satisfied"(덮을 기준 없음 = vacuously true) — 단 approved 오라클 바인딩은 필수(M2: 오라클 없으면 ready 불가).
- 결정론: 입력 순서 무관·동일 입력 동일 출력.

readiness 주입: `readyNodes(graph, { isDone, oracleSatisfied: (wp) => set.has(wp.id) })`. **[readiness.ts](../../../xzawedShared/src/task-graph/readiness.ts) 무변경**.

### 3.3 디스패치 & Supervisor 배선 (Manager)

- **[dispatch.ts](../../../xzawedManager/packages/server/src/streams/dispatch.ts) `handleDispatch`**: `DispatchDeps`에 `oracleStore: { approvedByWorkflow }` 추가. graph 로드 후 `approvedByWorkflow(workflowId)`→`oracleSatisfiedSet`→`planDispatch`에 `oracleSatisfied` 주입(기존 done-set `isDone`과 **합성**). flag off면 주입 생략(기본 술어·현행).
- **[supervisor.ts](../../../xzawedManager/packages/server/src/streams/supervisor.ts)**: `completionConsumer`와 동일 패턴 `oracleConsumer`(BaseConsumer · `oracle.approved` 스키마 구독 · **전용 Redis 연결** makeRedis로 xreadgroup BLOCK 직렬화 회피) 추가 → 핸들러가 `handleDispatch(workflowId, dispatch)`. `createSupervisor`가 `OracleRepo`를 dispatch deps에 주입. `Supervisor.start/stop`에 oracleConsumer 포함.
- 스트림(잠정): `oracle.approved`는 **전용 스트림 `manager:oracle:main`**(decomposition/completion `:main` 채널 모델 동일·workflowId는 봉투) 발행 → oracleConsumer 전용 그룹 `manager-oracle-consumers`. P2 배선 확정 시 재검토.

## 4. 데이터 흐름

```
[사람] POST /oracles (story별 시나리오 시드)        → oracles(status=pending)
[사람] PATCH /oracles/:id/approve                  → oracles(approved) + manager_events(oracle.approved) + outbox  [단일 tx]
OutboxRelay (500ms)                                → manager:oracle:main 발행
Supervisor.oracleConsumer (oracle.approved)        → handleDispatch(wf)
handleDispatch                                     → approvedByWorkflow → oracleSatisfiedSet → readyNodes(oracleSatisfied 주입)
                                                   → 충족·미디스패치 WP → recordDispatch(wp.dispatched + lease) → DISPATCHED
```

분해 직후 `afterPersisted` 디스패치는 오라클이 없어 0건(정상) — 승인이 뒤늦게 게이트를 연다. BaseConsumer 멱등 소비(M6)·바운드 재시도·DLQ가 oracleConsumer에 그대로 적용.

## 5. API (`api/oracle.route.ts`)

[knowledge.route.ts](../../../xzawedManager/packages/server/src/api/knowledge.route.ts) 패턴:
- `POST /workflows/:workflowId/oracles` — 오라클 생성(pending). body=Oracle 아티팩트(시나리오·coverage·story_id).
- `PATCH /oracles/:oracleId/approve` — 승인. body=`{approvedBy}`. → `OracleRepo.approve`.
- `GET /workflows/:workflowId/oracles` — 조회(status 필터).
- 쓰기(POST/PATCH)는 `authHook` 설정 시 서비스 JWT 필요(#213 패턴). DB 없으면 라우트 미등록(graceful).

## 6. 플래그 & 가역성

- `MANAGER_ORACLE_DOR`(기본 `false`·가역): off면 `handleDispatch`가 `oracleSatisfied`를 주입하지 않음 → 기본 술어(`oracleRef!=null`)·현행 동작·**회귀 0**. on이면 satisfied-set 주입 + Supervisor에 oracleConsumer 배선.
- `TASK_MANAGER_ENABLED`+`DATABASE_URL` 전제(Supervisor 배선 조건) 위에 얹힘.
- migration 009는 `runMigrations`로 항상 적용(빈 표 무해).

## 7. 테스트

- **순수 `oracleSatisfiedSet`**(shared): 충족 / AC 일부 미커버 / 시나리오 미승인(drafted만) / story 미바인딩 / 빈 AC / 결정론(입력순서 무관).
- **`OracleRepo`**(pg 통합·skip-if-no-DB): `approve` 단일 tx(oracles+events+outbox 원자성)·ROLLBACK 가드·`approvedByWorkflow` 필터·version++ upsert.
- **`handleDispatch` 오라클 주입**: satisfied WP만 dispatch · 미승인 story WP 제외 · flag off 회귀 0 · done-set `isDone`과 합성.
- **`oracleConsumer`**: `oracle.approved`→handleDispatch 트리거 · 멱등(중복 이벤트 1회 dispatch).
- **`api/oracle.route.ts`**: POST/PATCH/GET · JWT 가드 · DB 없을 때 graceful.

## 8. 위험 & 완화

- **사람 승인 병목**: 오라클 작성·승인은 사람 시간 의존. 이 슬라이스는 메커니즘만 — 비차단(승인 전 dispatch 0이 정상). LLM 초안(P7)이 후속에서 작성 부담을 흡수.
- **AC 문자열 동일성 단순화**: WP acceptanceCriteria와 oracle coverage 키가 정확히 일치해야 satisfied. 시드 시 동일 문자열 사용 전제. 정식 AC-id 매핑은 후속(불일치 시 미충족=보수적·안전 방향).
- **전용 스트림**: `oracle.approved`는 전용 `manager:oracle:main`으로 분리(세션 이벤트·decomposition.inconsistent와 격리) → oracleConsumer 단일 type 구독, 타 type 유입 시 invalid_schema DLQ(의도된 격리). `manager_events`(진실원천)에는 그대로 적재되나 발행 outbox 스트림만 전용.
- **멱등키**: `oracle.approved` 멱등키는 `{wf}:oracle.approved:{oracleId}:{version}` — 동일 승인 재전달은 M6 dedup으로 1회 처리.

## 9. 완료 정의 (수용 기준)

①migration 009 + OracleRepo(approve 단일 tx) ②순수 oracleSatisfiedSet + 테스트 ③handleDispatch 술어 주입(flag 가역·회귀 0) ④oracleConsumer Supervisor 배선 ⑤oracle API ⑥**end-to-end: 워크플로 분해→story 오라클 시드·승인→해당 WP가 처음으로 dispatch**(통합 테스트 또는 수동 검증) ⑦build·test·jscpd 0·audit 0.
