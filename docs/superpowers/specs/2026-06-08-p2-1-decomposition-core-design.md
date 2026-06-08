# P2-1 결정론 분해 코어 (커버리지 매트릭스·content-hash ID·재진입 병합) 설계

- 날짜: 2026-06-08
- 서비스: `xzawedShared`(@xzawed/agent-streams) — 순수 lib
- 로드맵: senario ROADMAP Phase 2 — **PM Agent 분해 파이프라인**의 첫 슬라이스. P1d Task Manager 전체 완료(#253~#262) 다음. P1d-1 정석안 재현.
- 선행 사양: `xzawedPAIS_handoff_spec.md` §6(분해 파이프라인) · WORKFLOW.md · ROADMAP.md Phase 2.

## 1. 목표 & 비범위

§6 분해 파이프라인 `decompose()`는 P0~P7 단계로 intent를 WP DAG로 분해한다. 그 중 **결정론 경계**("매트릭스·갭/중복 탐지·사이클 검사·위상정렬·안정 ID·병합은 순수 코드. LLM은 의미 판단에만")의 미구현 3종을 채운다. 사이클 검사·위상정렬은 P1d-1에 이미 존재(`detectCycle`·`topoSort`). 이 슬라이스는 나머지 **커버리지 매트릭스(P4)·content-hash 안정 ID(P7)·`merge_keep_inflight`(P7)**를 구현한다.

**범위(이 슬라이스)**: `coverageMatrix`·`contentHashId`·`mergeKeepInflight` 순수 함수 + 최소 입력 타입(`StoryCoverage`·`CoverageMatrix`·`WpHashInput`). I/O·DB·Redis·Claude·부수효과 0.

**비범위(후속 슬라이스, 엄격 제외)**:
- LLM 의미 분해(epic 식별·세로 슬라이스·deliverable 도출·역할 판정·간선 추론·`llm_repair`·`llm_break_cycle`) → P2-2.
- `decomposition.emitted` 생산자·발행·스트림 배선·트리거(task_request 등) → P2-2.
- 워커 완료 신호 생산자 → P3(실행 에이전트).
- Wiki Agent 리스크 분류·모델 라우팅(§5, P7 `wiki_agent.score`) → 별도 슬라이스.
- WP 상태머신 전이·DB latestStates 연동·실제 in-flight 판정 → 소비자가 술어 주입.
- **기존 코드 0줄 수정**(신규 파일 + index.ts export만). P1d-1과 동일 철학.

## 2. 설계 결정 (사용자 승인 2026-06-08)

1. **배치 = xzawedShared `src/decomposition/`**(신규 폴더). 그래프 알고리즘 `task-graph/`와 분리해 §6 분해 관심사를 응집. 순수 lib(서비스 아님), M3 무관. 파일당 한 관심사(`coverage-matrix.ts`·`content-hash.ts`·`stable-merge.ts`·`index.ts`).
2. **결정론 일관**: 모든 출력은 `task-graph/topo-sort.ts`의 `byId`(UTF-16 코드유닛·로케일 무관, `localeCompare` 금지)와 동일 규칙으로 id 정렬. N4 재현성 보존. `byId`는 그곳의 private const라 `decomposition/`은 동일 trivial 비교자를 인라인(1줄·jscpd min-tokens 미달이라 CPD 무영향, "기존 코드 0줄" 보존 — 공유 util 추출은 기존 파일 수정이라 회피).
3. **content-hash 필드 경계**: `storyId`·`owningRole`·`acceptanceCriteria`만 해싱(의미 정체성). `id`·`status`·`attributionCounters`·`oracleRef`·`dependencies` **제외**. `dependencies` 제외로 의존 WP의 ID 변경이 연쇄 재-ID를 유발하지 않음(연쇄 안정 우선). 트레이드오프는 §4.2.
4. **`mergeKeepInflight` = 주입형 `isInflight` 술어**(readiness의 `isDone`/`oracleSatisfied` 패턴). 실 in-flight 지식은 DB `latestStates`라 코어를 블로킹하지 않고 seam만 남김. 기본 술어는 `status` 기반(§4.3).
5. **참조 무결성 불변식**: `mergeKeepInflight` 출력은 항상 `buildTaskGraph`가 수용 가능(dangling 의존 0). 유지하는 in-flight 노드의 existing 내 **의존 폐포**를 함께 유지해 보장.
6. **순수 탐지/계산만 — 수선·에스컬레이션 없음**: `coverageMatrix`는 갭/중복/unknown을 **데이터로 보고**(throw 아님). 수선(`llm_repair`)·구조 에스컬레이션은 소비 단계(P2-2) 책임. `buildTaskGraph`의 throw 규약과 대칭(입력 무결성 위반만 throw, 의미 결함은 데이터).

## 3. API (`xzawedShared/src/decomposition/`)

### 3.1 커버리지 매트릭스 (`coverage-matrix.ts`) — §6 P4 "100% 규칙"

```ts
/** 한 Story가 덮는(claim) 산출물 id 목록. */
export interface StoryCoverage {
  storyId: string
  deliverableIds: string[]
}

/** 스토리×산출물 대조 결과. 모든 배열 id 사전순(결정론). */
export interface CoverageMatrix {
  /** 어느 스토리도 덮지 않는 산출물 id(빈 컬럼 = 갭). */
  gaps: string[]
  /** 2개 이상 스토리가 덮는 산출물(다중 주장 = 중복). repair 타깃팅용으로 storyIds 동반. */
  overlaps: Array<{ deliverableId: string; storyIds: string[] }>
  /** 산출물 인벤토리에 없는 id를 주장한 스토리(구조 무결성 가드). */
  unknownClaims: Array<{ storyId: string; deliverableId: string }>
}

export function coverageMatrix(stories: StoryCoverage[], deliverables: string[]): CoverageMatrix
```
- `gaps` = `deliverables` 중 어떤 `story.deliverableIds`에도 없는 것(id 정렬).
- `overlaps` = 인벤토리 산출물 중 주장 스토리 ≥2개인 것. `storyIds`도 id 정렬, `deliverableId` 기준 정렬.
- `unknownClaims` = 스토리가 주장한 `deliverableId`가 `deliverables`에 없는 경우(`buildTaskGraph` dangling-dep 검사 대응). `storyId`→`deliverableId` 정렬.
- 같은 스토리가 같은 산출물을 중복 나열해도 1회로 계수(주장 집합화).
- 빈 입력: stories=[] → 모든 deliverable이 gap, overlaps=[], unknownClaims=[]. deliverables=[] → 모든 주장이 unknownClaims, gaps=[].

### 3.2 content-hash 안정 ID (`content-hash.ts`) — §6 P7 `p.id = content_hash(p)`

```ts
/** content-hash 입력 = WP의 의미 정체성 필드(휘발/그래프 구조 필드 제외). */
export interface WpHashInput {
  storyId: string
  owningRole: string
  acceptanceCriteria: string[]
}

/** 안정 WP id. 같은 의미 내용 → 같은 id(N4 재진입 안정). 형식: "wp_" + sha256 hex 32자(128bit). */
export function contentHashId(content: WpHashInput): string
```
- canonical 직렬화: 키 고정 순서 + `acceptanceCriteria` **정렬 후** 해싱 → 입력 순서 무관 안정. 빈 criteria 허용.
- `crypto.createHash('sha256')`(Node 표준, `makeEnvelope`의 `crypto.randomUUID`와 동일 모듈). 출력 `wp_` 접두 + hex 32자.
- 제외 필드(`status`·`attributionCounters`·`oracleRef`·`dependencies`·`id`)는 ID에 무영향 — 상태 변화·oracle 부착·의존 변경이 ID를 바꾸지 않음.

### 3.3 재진입 병합 (`stable-merge.ts`) — §6 `merge_keep_inflight`

```ts
export interface MergeOptions {
  /**
   * 노드가 in-flight(진행 중이라 재기록 금지)인지. 기본: status ∈ {in_progress, blocked, done}.
   * 실 운영은 DB latestStates 기반 술어를 소비자가 주입.
   */
  isInflight?: (wp: WorkPackage) => boolean
}

/** 재분해 병합: incoming을 적용하되 existing의 in-flight 노드(+의존 폐포)는 보존. 출력 id 정렬. */
export function mergeKeepInflight(
  existing: WorkPackage[],
  incoming: WorkPackage[],
  opts?: MergeOptions,
): WorkPackage[]
```
content-hash `id`로 동일성 판정. 병합 규칙:

| existing | incoming | in-flight | 결과 |
|---|---|---|---|
| 없음 | 있음 | — | **incoming 추가**(새 작업) |
| 있음 | 있음 | yes | **existing 유지**(재기록 금지) |
| 있음 | 있음 | no | **incoming 채택**(미착수 갱신 안전) |
| 있음 | 없음 | yes | **existing 유지**(진행분 보존) |
| 있음 | 없음 | no | **드롭**(재분해로 대체·제거) |

- **참조 무결성(§2-5)**: 보존된 in-flight 노드가 의존하는 existing 노드는, incoming에 없고 not-in-flight라도 **함께 유지**(의존 폐포 보존). → 출력이 `buildTaskGraph` 수용 가능(dangling 0). 폐포는 existing 그래프 내에서만 계산(incoming은 자체 정합).
- 기본 `isInflight` = `wp.status` ∈ {`in_progress`, `blocked`, `done`}. (`draft`/`ready`는 미착수 → 갱신 가능.)
- 결정론: 출력 `byId` 정렬(입력 순서 무관). 같은 (existing, incoming, isInflight) → 같은 출력.

### 3.4 export
- 배럴 `src/decomposition/index.ts`에서 위 전부 + 타입 재노출.
- 루트 `src/index.ts`에 `export { coverageMatrix, contentHashId, mergeKeepInflight } from './decomposition/index.js'` + `export type { StoryCoverage, CoverageMatrix, WpHashInput, MergeOptions } from './decomposition/index.js'`.

## 4. 핵심 설계 근거

### 4.1 결정론 경계 (§6, N4)
LLM은 의미 판단(식별/슬라이싱/도출/역할/간선/수선)만, 검증·ID·병합은 순수 코드. 이 슬라이스는 후자 전부를 LLM 비호출로 재현 가능하게 고정. ROADMAP Phase 2 수용기준 "결정론 구간(매트릭스/사이클/위상정렬/ID/병합)은 LLM 비호출로 재현"의 직접 충족.

### 4.2 content-hash가 `dependencies`를 제외하는 이유
N4 "재분해가 진행 중 브랜치를 다시 쓰지 않음"의 핵심은 *같은 작업 → 같은 ID*. 의존을 해싱하면 의존 WP의 ID 변경이 연쇄 재-ID를 유발해 안정성이 무너진다. 의존 구조는 그래프(엣지)가 표현하므로 ID에서 분리. 충돌 위험(같은 story+role+criteria, 다른 의존)은 §6 원자성 규칙(WP=단일 역할, 스토리 내 역할당 1 WP)으로 실무상 차단. P3에서 §7 전체 계약(inputs/outputs)이 오면 `WpHashInput`을 확장해 변별력 강화.

### 4.3 `isInflight` 주입과 의존 폐포
in-flight 진실은 런타임 상태(DB latestStates)지 정적 WP 필드가 아니다(P1d-6에서 done 판정을 latestStates 파생으로 전환한 것과 동형). 코어는 술어 seam만 두고 기본값(status 기반)은 테스트·단독 사용 편의. 의존 폐포 보존은 "진행 중 노드가 가리키는 선행이 사라져 그래프가 깨지는" 실패를 원천 차단 — 순수 병합이 항상 유효 그래프를 산출하는 불변식.

## 5. 테스트 (TDD, `src/__tests__/decomposition.test.ts`)

- **coverageMatrix**: 완전 커버(갭·중복·unknown 모두 []), 갭 검출, 중복 검출(storyIds 정확·정렬), unknownClaims 검출, 같은 스토리 산출물 중복 나열 집합화, 빈 stories/빈 deliverables, 결정론(입력 순서 무관).
- **contentHashId**: `wp_` 접두·hex 32자 포맷, criteria 순서 무관 동일 ID, 동일 입력 반복 동일 ID, 다른 의미 입력 다른 ID, 제외 필드(status/oracleRef/dependencies/attributionCounters 변경) ID 불변, 빈 criteria.
- **mergeKeepInflight**: 신규 추가, 미착수(draft/ready) incoming 채택, in-flight(in_progress/done) existing 유지, incoming에서 사라진 not-in-flight 드롭, in-flight 유지 + 의존 폐포 보존(dangling 0 — `buildTaskGraph` 통과 검증), `isInflight` 주입 override, 결정론 출력 순서, 빈 existing/빈 incoming.

## 6. 회귀·검증

기존 코드 0줄 수정 → 회귀 0(신규 파일 + index export만). `cd xzawedShared && pnpm build && pnpm test`(162→증가). 적대적 멀티에이전트 리뷰(결정론·content-hash 안정성·의존 폐포 정합·순수성·경계 케이스). CPD 0·audit 0. PR → CI 그린 → squash 머지. CLAUDE.md(xzawedShared·루트)·HANDOFF·메모리 갱신.

**다음 슬라이스 = P2-2**: LLM 의미 분해 파이프라인(§6 P1~P5) + 이 3종 코어 호출 + `decomposition.emitted` 생산자/발행·스트림 배선. 생산자 위치(신규 PM 서비스 vs Manager vs Planner 확장)를 그 슬라이스 brainstorming에서 결정.
