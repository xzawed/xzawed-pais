# P1d-3 Task Graph 영속 (task_graphs + wp_state_log) 설계

- 날짜: 2026-06-07
- 서비스: `xzawedManager`(packages/server) — Postgres 영속
- 로드맵: senario ROADMAP Phase 1 — **P1d 결정론적 Task Manager**의 두 번째 슬라이스(2/7). P1d-1 Core(#253) 다음, P1d-2 소비보다 **선행**(소비하려면 그래프를 영속할 곳이 먼저 있어야 함).

## 1. 목표 & 비범위

P1d Task Manager가 WP(Work Package) 의존성 그래프를 **저장·복원**할 영속 토대를 만든다. 이 슬라이스는 스키마 2개 + thin repo + 테스트만 추가하는 **순수 additive·미배선** 슬라이스다(P0 토대 스키마 #239와 동일 스타일).

**범위(이 슬라이스)**:
- 마이그레이션 `007_task_graphs.sql` — `task_graphs`(워크플로 그래프 프로젝션) + `wp_state_log`(WP 상태 전이 append-only 로그).
- `db/task-graph.repo.ts` `TaskGraphRepo` — upsert/조회/전이 기록/최신상태 조회.
- 유닛 + skip-if-no-DB 통합 테스트.

**비범위(후속 슬라이스, 엄격 제외)**: `decomposition.emitted` 소비·`buildTaskGraph` 호출·그래프 빌드(P1d-2), `wp.dispatched` 발행·step-N 부여(P1d-4), lease/escalation(P1d-5), runner.ts·server.ts 수정, WP 상태머신 enum 강제(미배선). **기존 코드 0줄 수정** — 신규 마이그레이션 + 신규 repo + 신규 테스트만. `runMigrations`(pool.ts)가 `migrations/`의 모든 `.sql`을 번호순 자동 적용하므로 server.ts 배선도 불필요.

## 2. 설계 결정 (PO 승인)

1. **배치 = xzawedManager Postgres**. OPERATIONS §2 "진실 원천은 항상 Postgres"·HANDOFF "P1d-3(Manager)". 기존 pool/migrations/repo 인프라(#243) 재사용.
2. **task_graphs = 가변 프로젝션(upsert)** [PO 결정]. workflow_id당 1행, 재분해 시 `version++`로 UPDATE. 기존 `manager_sessions`(가변 프로젝션) + `manager_events`(append-only 로그) **이원 패턴과 일치**. 이력 감사는 `wp_state_log` + `manager_events`가 전담하므로 그래프 자체는 빠른 조회용 프로젝션으로 충분. WP0 #7(mutable→immutable) 미결 상태를 블로킹하지 않고 가역.
3. **wp_state_log = append-only 로그**. WP 상태 전이를 INSERT만(코드 규약, manager_events 선례). P4 결함 국소화·감사·replay의 토대.
4. **graph_dag JSONB = `{ workPackages: WorkPackage[] }`만 저장**(노드 소스). 인접/역인접(dependents)은 파생 데이터라 저장하지 않고 조회 측이 `buildTaskGraph(wps)`로 재구성(DRY·결정론 유지·contract-drift 회피). 노드 타입은 `WorkPackage` 재사용(재정의 금지).
5. **`to_state`/`from_state` = TEXT(CHECK enum 없음)**. WP 8+2 상태머신(WORKFLOW §B)이 아직 미배선(P1d-4/5/6) → 전방호환 위해 TEXT. 상태머신 배선 시 CHECK 제약 추가.
6. **`event_id` = nullable·하드 FK 없음**. 이 슬라이스는 미배선이라 실제 `decomposition.emitted` event가 없음(테스트는 null). 출처(provenance, M7) 컬럼만 남기고 FK 강화는 P1d-2 배선 시. (outbox의 하드 FK와 달리 디커플 우선 — additive 슬라이스 독립성.)
7. **repo는 그래프를 재구성하지 않는다**. `getGraph`는 `WorkPackage[]`를 (재검증해) 반환하고, `buildTaskGraph` 호출은 소비자(P1d-2/P1d-4) 책임 → repo = thin 영속 계층(M3 경계·단일 책임).

## 3. 스키마 (`db/migrations/007_task_graphs.sql`)

```sql
-- task_graphs: 워크플로당 현재(병합된) WP DAG 프로젝션 (가변 — 재분해 시 UPDATE).
-- 진실원천은 manager_events(decomposition.emitted)·wp_state_log(전이). 이 표는 빠른 조회용 프로젝션.
CREATE TABLE IF NOT EXISTS task_graphs (
  workflow_id  TEXT        PRIMARY KEY,
  graph_dag    JSONB       NOT NULL,            -- { workPackages: WorkPackage[] } — 노드 소스만 저장
  event_id     UUID        NULL,                -- 출처 decomposition.emitted (provenance, P1d-2가 채움)
  version      INT         NOT NULL DEFAULT 1,  -- 재분해 병합 시 ++
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- wp_state_log: WP 상태 전이 append-only 로그 (감사·국소화 토대). 코드 규약으로 INSERT만(UPDATE/DELETE 없음).
CREATE TABLE IF NOT EXISTS wp_state_log (
  seq          BIGSERIAL   PRIMARY KEY,
  workflow_id  TEXT        NOT NULL,
  wp_id        TEXT        NOT NULL,
  from_state   TEXT        NULL,                -- 최초 전이는 NULL
  to_state     TEXT        NOT NULL,            -- WP 상태머신(WORKFLOW §B); 미배선이라 CHECK 없이 TEXT(전방호환)
  event_id     UUID        NULL,                -- 유발 event (causation, P1d-4+가 채움)
  reason       TEXT        NULL,                -- 귀속/사유(P4 fault-localization 토대)
  occurred_at  BIGINT      NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_state_log_wp ON wp_state_log (workflow_id, wp_id, seq);
```

## 4. Repo API (`db/task-graph.repo.ts`)

`EventStore`/`SessionRepo`와 동일하게 `Pool` 주입. `now: () => number = () => Date.now()`(테스트 결정론). `@xzawed/agent-streams`의 `WorkPackageSchema`로 읽기 재검증(Manager는 이미 의존).

```ts
import type { Pool } from 'pg'
import { WorkPackageSchema, type WorkPackage } from '@xzawed/agent-streams'

export interface PersistGraphInput {
  workflowId: string
  workPackages: WorkPackage[]
  eventId?: string | null
}
export interface StoredGraph {
  workflowId: string
  workPackages: WorkPackage[]
  eventId: string | null
  version: number
}
export interface WpTransitionInput {
  workflowId: string
  wpId: string
  toState: string
  fromState?: string | null
  eventId?: string | null
  reason?: string | null
}
export interface WpStateRecord {
  seq: number
  workflowId: string
  wpId: string
  fromState: string | null
  toState: string
  eventId: string | null
  reason: string | null
  occurredAt: number
}

export class TaskGraphRepo {
  constructor(pool: Pool, now?: () => number)

  /** 워크플로 그래프 프로젝션 upsert(재분해 시 version++·graph_dag 교체). */
  upsertGraph(input: PersistGraphInput): Promise<{ version: number }>

  /** 그래프 조회(graph_dag.workPackages를 WorkPackageSchema 배열로 재검증). 없으면 null. */
  getGraph(workflowId: string): Promise<StoredGraph | null>

  /** WP 상태 전이를 append-only 기록(INSERT only). */
  appendTransition(input: WpTransitionInput): Promise<{ seq: number }>

  /** WP별 최신 상태(seq 최대). DISTINCT ON (wp_id) ORDER BY wp_id, seq DESC. */
  latestStates(workflowId: string): Promise<Map<string, WpStateRecord>>

  /** 한 WP의 전이 이력(seq 오름차순). */
  transitions(workflowId: string, wpId: string): Promise<WpStateRecord[]>
}
```

핵심 SQL:
- `upsertGraph`: `INSERT INTO task_graphs (...) VALUES ($1,$2,$3,1,NOW(),NOW()) ON CONFLICT (workflow_id) DO UPDATE SET graph_dag=EXCLUDED.graph_dag, event_id=EXCLUDED.event_id, version=task_graphs.version+1, updated_at=NOW() RETURNING version`. graph_dag는 `JSON.stringify({ workPackages })`.
- `getGraph`: `SELECT graph_dag, event_id, version FROM task_graphs WHERE workflow_id=$1`. `graph_dag.workPackages`를 `z.array(WorkPackageSchema).parse`로 재검증(저장 깨짐 방어).
- `appendTransition`: `INSERT INTO wp_state_log (workflow_id, wp_id, from_state, to_state, event_id, reason, occurred_at) VALUES (...) RETURNING seq`. `occurred_at = now()`.
- `latestStates`: `SELECT DISTINCT ON (wp_id) ... FROM wp_state_log WHERE workflow_id=$1 ORDER BY wp_id, seq DESC` → Map.
- `transitions`: `SELECT ... WHERE workflow_id=$1 AND wp_id=$2 ORDER BY seq ASC`.

## 5. 테스트 (TDD)

`EventStore` 선례(유닛 + skip-if-no-DB 통합) 따름:

- **유닛** (`db/task-graph.repo.test.ts`, fake/mock pool):
  - `upsertGraph`: INSERT 파라미터·graph_dag 직렬화·`ON CONFLICT … version+1` SQL 형태, RETURNING version 매핑.
  - `getGraph`: 행 없음 → null; graph_dag.workPackages가 WorkPackageSchema로 파싱(유효/무효 시 throw).
  - `appendTransition`: INSERT only(UPDATE/DELETE 미사용)·파라미터·occurred_at 주입.
  - `latestStates`: DISTINCT ON 결과 → Map<wpId, record> 매핑.
  - `transitions`: seq ASC 매핑.
- **통합** (`test/task-graph-persistence.integration.test.ts`, `DATABASE_URL` 없으면 `describe.skip`):
  - 실 pg 라운드트립: `upsertGraph` → `getGraph` WP 배열 동등성.
  - 재분해: 같은 workflow_id 재upsert → version 2, graph_dag 교체.
  - `appendTransition` 다중 → `transitions` seq 오름차순, `latestStates`가 WP별 최신 to_state.

## 6. 회귀·검증

기존 코드 0줄 수정 → 회귀 0(신규 마이그레이션 + repo + 테스트만, runMigrations 자동 적용). `cd xzawedManager && pnpm build && pnpm test`(375 → 유닛 증가, 통합은 +조건부 skip). `pnpm audit`. 적대적 리뷰(upsert 원자성·JSONB 파싱 안전·append-only 규약·DISTINCT ON 정확·now 주입 결정론). PR → CI(module-boundaries 포함) 그린 → squash 머지. CLAUDE.md(xzawedManager 구조·migrations 006→007)·HANDOFF·메모리 갱신. **다음 P1d-2(소비): `decomposition.emitted` 멱등 소비 → `buildTaskGraph` → `upsertGraph` 영속.**
