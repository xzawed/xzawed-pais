# P1d-1 Task Manager Core (순수 그래프/스케줄링 로직) 설계

- 날짜: 2026-06-07
- 서비스: `xzawedShared`(@xzawed/agent-streams) — 순수 lib
- 로드맵: senario ROADMAP Phase 1 — **P1d 결정론적 Task Manager**의 첫 슬라이스(1/7). 4에이전트 설계 패널 정석안. P1c 완료(#247~#252) 다음.

## 1. 목표 & 비범위

P1d Task Manager = WP(Work Package) 의존성 그래프(DAG)의 **ready 노드만 결정론적으로** 산출하는 스케줄러. 이 슬라이스는 그 **순수 계산 코어**(I/O·DB·Redis·Claude·부수효과 0)를 구현한다. 사양 §6 "매트릭스·갭/중복·사이클검사·위상정렬·안정 ID·병합 = 순수 코드, LLM은 의미판단(수선)에만"의 결정론 경계 그 자체.

**범위(이 슬라이스)**: `buildTaskGraph`·`detectCycle`·`topoSort`·`isReady`/`readyNodes` 순수 함수 + `TaskGraph` 타입.

**비범위(후속 슬라이스, 엄격 제외)**: Redis/Postgres I/O, `decomposition.emitted` 소비, `wp.dispatched` 발행, lease/escalation, status enum 전이·상태머신, 사이클 수선(`llm_break_cycle` — P1d-2), step-N 실제 부여·기록(P1d-4), runner.ts 수정. **기존 코드 0줄 수정**(신규 파일 + index.ts export만).

## 2. 설계 결정 (4에이전트 패널 + 사용자 승인)

1. **배치 = xzawedShared `src/task-graph/`** 순수 lib(서비스 아님). work-package.ts와 동거(같은 패키지 상대 import), M3 무관(공통 lib). 후속 4슬라이스가 이 코어의 소비자 → 토대성 최대.
2. **WorkPackage 재사용**(노드 페이로드) + `TaskGraph` 컨테이너 신설. 노드 재정의 금지(contract-drift 안티패턴).
3. **인메모리 only**. 영속(task_graphs·wp_state_log)은 P1d-3. OPERATIONS §2 "Postgres 진실원천"은 *상태 영속*에 적용, *위상 계산*(순수)과 무관.
4. **오라클 = 주입형 술어** `oracleSatisfied?: (wp) => boolean`(기본 `wp.oracleRef != null`). §7 DoR의 human_approved≥1은 P3 Oracle 스키마 영역 → 코어를 블로킹 안 시키고 seam만 남김.
5. `isReady`는 `wp.status`를 **읽지 않음**(deps done + oracle만). done 판정은 외부 주입(`isDone: (id) => boolean`). WORKFLOW 9+2 상태머신 드리프트 회피.
6. `detectCycle`은 순수 탐지만(수선 llm_break_cycle은 P1d-2). `topoSort`는 사이클 시 throw 아닌 `{order, cyclic}` 데이터 반환(throw는 입력 무결성 위반 한정).

## 3. API (xzawedShared/src/task-graph/)

### 3.1 타입 (`task-graph.ts`)

```ts
import type { WorkPackage } from '../types/work-package.js'

/** WP DAG의 불변 컨테이너. 노드=WorkPackage(재사용), 엣지=dependencies. */
export interface TaskGraph {
  /** id → WorkPackage. 삽입 순서 보존(결정론 타이브레이크 토대). */
  readonly nodes: ReadonlyMap<string, WorkPackage>
  /** id → 직접 의존(선행) id 집합 = wp.dependencies. */
  readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>
  /** id → 이 노드를 의존하는 후행 id 집합(역인접). */
  readonly dependents: ReadonlyMap<string, ReadonlySet<string>>
}
```

### 3.2 빌더 (`task-graph.ts`)

```ts
export function buildTaskGraph(wps: WorkPackage[]): TaskGraph
```
- 중복 id → `throw new Error('buildTaskGraph: duplicate work package id: <id>')`.
- dangling dependency(존재하지 않는 id 참조) → `throw new Error('buildTaskGraph: unknown dependency "<dep>" referenced by "<id>"')`.
- 입력 배열 순서를 `nodes` 삽입 순서로 보존.
- (입력 무결성 위반만 throw — 사이클은 throw 아님, detectCycle/topoSort가 데이터로 보고.)

### 3.3 사이클·위상정렬 (`topo-sort.ts`)

```ts
/** 사이클에 속한 노드 경로 목록(없으면 []). DFS 기반. */
export function detectCycle(graph: TaskGraph): string[][]

/** Kahn 위상정렬. order=정렬된 id(결정론), cyclic=사이클로 정렬 못한 잔여 id. */
export function topoSort(graph: TaskGraph): { order: string[]; cyclic: string[] }
```
- **결정론 타이브레이크**: in-degree 0 후보가 여럿이면 (a) `nodes` 삽입 순서 우선, 동순위는 (b) id 사전순. → 같은 입력 항상 같은 order(N4 step-N 토대).
- 사이클이면 해당 노드들은 `order`에 안 들어가고 `cyclic`에 모임(throw 안 함).

### 3.4 readiness (`readiness.ts`)

```ts
export interface ReadinessOptions {
  /** 노드가 done인지. 기본: status === 'done'. */
  isDone?: (wp: WorkPackage) => boolean
  /** 오라클 충족 여부(DoR). 기본: wp.oracleRef != null. */
  oracleSatisfied?: (wp: WorkPackage) => boolean
}

/** DoR: 모든 dependency가 done AND oracle 충족 AND 자신이 아직 done 아님. */
export function isReady(wp: WorkPackage, graph: TaskGraph, opts?: ReadinessOptions): boolean

/** ready 노드 id 목록(topoSort order 순서로 정렬 — 결정론). */
export function readyNodes(graph: TaskGraph, opts?: ReadinessOptions): string[]
```
- `isReady` 규칙: (1) `!isDone(wp)` (2) 모든 `dep ∈ dependencies(wp.id)`에 대해 `isDone(node(dep))` (3) `oracleSatisfied(wp)`. 셋 다 true면 ready.
- `isDone` 기본 = `wp.status === 'done'`(주입 시 외부 done-set 사용). `oracleSatisfied` 기본 = `wp.oracleRef != null`.
- `readyNodes`는 `topoSort(graph).order` 순회하며 `isReady`인 것만 반환(결정론 순서). 사이클(cyclic) 노드는 제외.

### 3.5 export (`index.ts` / `task-graph/index.ts`)
- 배럴 `src/task-graph/index.ts`에서 위 전부 재노출. 루트 `src/index.ts`에 `export * from './task-graph/index.js'`(또는 명시 export) + `export type { TaskGraph, ReadinessOptions }`.

## 4. 테스트 (TDD, `src/__tests__/task-graph.test.ts`)

- **buildTaskGraph**: 정상 빌드(nodes/dependencies/dependents 정확), 중복 id throw, dangling dep throw, 빈 입력.
- **detectCycle**: 비순환 → [], 단순 사이클(A→B→A) 검출, 자기참조(A→A), 다중 사이클.
- **topoSort**: 선형(A→B→C) 순서, 분기(A→{B,C}) 결정론(삽입순·id 사전순 타이브레이크), 사이클 시 order/cyclic 분리, 같은 입력 반복 동일 order.
- **isReady/readyNodes**: deps 미완 → not ready, deps done → ready, oracle 없음(oracleRef null) → not ready, oracleSatisfied 주입 override, isDone 주입(외부 done-set), 이미 done → not ready, readyNodes 결정론 순서·cyclic 제외.

## 5. 회귀·검증

기존 코드 0줄 수정 → 회귀 0(신규 파일 + index export만). `cd xzawedShared && pnpm build && pnpm test`(137→증가). 적대적 리뷰(결정론 타이브레이크·DoR 가드 정확·사이클 처리·순수성). PR → CI 그린 → squash 머지. CLAUDE.md·HANDOFF·메모리 갱신. **다음 P1d-3(영속 스키마).**
