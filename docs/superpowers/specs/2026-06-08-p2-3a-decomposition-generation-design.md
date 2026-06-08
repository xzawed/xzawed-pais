# P2-3a 다단계 분해 생성 파이프라인 (Manager 내장) 설계

- 날짜: 2026-06-08
- 서비스: `xzawedManager`(packages/server)
- 로드맵: senario ROADMAP Phase 2 — **PM Agent 분해 파이프라인**. P2-1 결정론 코어(#263)·P2-2 워킹 스켈레톤(#264) 다음. P1d Supervisor(#262)가 소비자로 대기 중.
- 선행 사양: `xzawedPAIS_handoff_spec.md` §6(분해 파이프라인, 하이브리드)·§20.2(독립 각도+반증 수렴) · `2026-06-08-p2-1-decomposition-core-design.md` · `2026-06-08-p2-2-decomposition-producer-design.md`.

## 1. 목표 & 비범위

P2-2의 **단일 LLM 호출**을, §6 **P1·P2·P3·P5**를 충실히 구현한 **4단계 LLM 파이프라인**으로 교체한다. 각 단계는 격리된 순수 파서+Zod로 검증되고 실패 시 graceful degrade한다. 커버리지 매트릭스(P2-1 `coverageMatrix`, 순수)는 **보고 전용**으로 계산·로그만 하고 수선은 안 한다. 목적은 *coverage-aware 다단계 의미 분해* 자체를 flag 뒤·최소 리스크로 도입하는 것.

**PO 결정(2026-06-08)**:
1. **2슬라이스 분할** — **P2-3a = 다단계 생성**(이 문서), P2-3b = 자가수선(P4 repair 루프 + 세로슬라이스 린트 + repair 소진 에스컬레이션).
2. **단계별 분리 호출(배치)** — 4개 고정 LLM 호출: epics(1) → vertical slice(전 epic 배치 1) → deliverables(독립 1) → roles(전 story 배치 1). §6 단계 충실 + deliverable 독립 각도(§20.2) 유지 + 호출 수 예측가능·단계별 mock 용이.
3. **epic은 파이프라인 내부에만 유지(YAGNI)** — 최종 WP에 `epicId` 미부착. `WorkPackageSchema` 변경 0·전 소비자 영향 0·`contentHashId` 불변. 필요 시 나중에 JSONB로 비파괴 추가 가능.
4. **flat WP(간선 없음)** — 3a는 `dependencies=[]` WP를 emit. flag-gated·`oracleRef=null`이라 실 디스패치 미발생 → 기능 영향 0.
5. **coverage 로그 전용** — 3a는 gaps/overlaps/unknown을 로그만 남기고 emit 페이로드는 불변(P2-2 정확 일치 테스트 보존). surface 여부는 3b가 결정.

**범위(이 슬라이스)**:
- `decompose/stages/run-stage.ts` — 제네릭 단계 실행기(call+parse+degrade 공통화, CPD 회피).
- `decompose/stages/epics.ts`·`slice.ts`·`deliverables.ts`·`roles.ts` — 4단계(각각 prompt + Zod 스키마 + fallback).
- `decompose/pipeline.ts` — `runDecomposition(intent, deps)`(4단계 순차 → 커버리지 매트릭스 보고 → story×role 전개 → 기존 `toWorkPackages`).
- `decompose/producer.ts` 수정 — `produceDecomposition`이 `runDecomposition` 사용. emit 페이로드(`{workPackages}`) 불변, 전체 붕괴 시 단일 WP fallback 보존.
- `config.ts` — LLM timeout/max_tokens를 config로 이동(Planner runner 패턴, P2-2 리뷰 이월 Minor).
- 단위 테스트(단계별 happy+degrade·run-stage 제네릭·pipeline end-to-end·producer 통합) + flag-off 회귀 0.

**비범위(후속, 엄격 제외)**:
- **P4 자가수선**: `coverageMatrix` 결과로 `llm_repair`를 K회 호출하는 repair 루프, 소진 시 에스컬레이션. → **P2-3b**.
- **세로슬라이스 린트**(P5 소프트 린트: 한 story가 정확히 한 직능으로만 매핑되면 재슬라이싱 후보). → **P2-3b**.
- **P6 간선 추론**(`llm_infer_edges`) — 3a는 flat WP. 대안(스토리 내 역할 결정론 순서 부여)은 사양 P6=LLM이라 비충실 → 별도 슬라이스로 이월.
- **P7 enrich/merge**: oracleRef 채움(P3 Oracle)·risk 점수(Wiki Agent §5)·`mergeKeepInflight` 배선. → 별도.
- decomposition.emitted를 트랜잭셔널 아웃박스 경유 발행(P2-2 대로 직접 스트림). → 후속 하드닝.
- Orchestrator UI가 `decompose_request`를 보내는 UX 배선. → 후속.

## 2. 데이터 흐름

```
orchestrator:to-manager:{sessionId}  --decompose_request{intent}-->  [flag MANAGER_DECOMPOSE_ENABLED]
  → produceDecomposition(intent, workflowId=sessionId)
      → runDecomposition(intent, deps):
          identifyEpics(intent)            → Epic[]   {epicRef, title}
          sliceVertical(epics, intent)     → Story[]  {storyId, epicRef, title, deliverableIds[]=claims, acceptanceCriteria[]}
          deriveDeliverables(intent)       → string[] (독립 인벤토리)
          coverageMatrix(stories→StoryCoverage, deliverables)   [P2-1 순수]  → {gaps,overlaps,unknownClaims}  ← 로그만
          assignRoles(stories)             → Map<storyId, role[]>
          전개: 각 (story × role) → LlmWorkPackage {ref:`${storyId}:${role}`, storyId,
                                                     owningRole:role, acceptanceCriteria: story.acceptanceCriteria, dependsOn:[]}
          toWorkPackages(LlmWorkPackage[]) [기존 map.ts]  → content-hash WP[]
      → makeEnvelope(workflowId, stepId='decomposition.emitted', attemptId=0)
      → publish('manager:decomposition:main', {envelope, type:'decomposition.emitted', payload:{workPackages}})
  → (Supervisor) DecompositionConsumer 소비 → buildTaskGraph → upsertGraph → handleDispatch(readyNodes=∅, oracleRef null)
```

P2-2와 동일하게 emit 이후 흐름(봉투·스트림·Supervisor 소비)은 불변. 바뀌는 것은 `runDecomposition` 내부(단일 호출 → 4단계)뿐.

## 3. 모듈 구조 (`xzawedManager/packages/server/src/decompose/`)

### 3.1 `stages/run-stage.ts` — 제네릭 단계 실행기
```ts
export interface StageDeps { claude: ClaudeLike; model: string; timeoutMs: number }
export interface StageSpec<T> {
  system: string
  user: string
  maxTokens: number
  schema: ZodType<T>      // 래핑 오브젝트 스키마 (예: { epics: [...] })
  fallback: () => T       // 파싱·빈 결과·throw 시 반환
}
export async function runStage<T>(deps: StageDeps, spec: StageSpec<T>): Promise<T>
```
- 흐름: `callClaudeText` → `stripJsonFences` + 중괄호 추출(`{`..`}`) → `JSON.parse` → `spec.schema.safeParse` → 성공이면 데이터, **어떤 실패(throw·파싱 불가·검증 실패)든 `spec.fallback()`**.
- 4단계가 이 함수만 호출 → call+parse+degrade 보일러플레이트 1곳(jscpd minTokens=100 클론 회피). 각 단계 파일은 prompt+schema+fallback만 남음.

### 3.2 단계 파일 (각각 순수 변환 + `runStage` 위임)
- `stages/epics.ts` — `identifyEpics(intent, deps) → Epic[]`. 스키마 `{ epics: [{epicRef, title}] }`. degrade → `[{epicRef:'epic-1', title:intent}]`.
- `stages/slice.ts` — `sliceVertical(epics, intent, deps) → Story[]`. 스키마 `{ stories: [{storyId, epicRef, title, deliverableIds[], acceptanceCriteria[]}] }`. degrade → 각 epic = 1 story(`deliverableIds:[]`, `acceptanceCriteria:[epic.title]`). epicRef를 프롬프트에 제공해 epic↔story 연결.
- `stages/deliverables.ts` — `deriveDeliverables(intent, deps) → string[]`. 스키마 `{ deliverables: [string] }`. **독립 호출**(slice와 분리=교차각도). degrade → `[]`.
- `stages/roles.ts` — `assignRoles(stories, deps) → Map<storyId, role[]>`. 스키마 `{ assignments: [{storyId, roles:[string]}] }`. degrade → 각 story `['developer']`. 미지/누락 storyId는 `['developer']` 보정(전 story가 ≥1 역할 보장).

역할 값은 P2-2 프롬프트와 동일 집합(`developer|designer|tester|builder|security`). `owningRole`은 현재 자유 string 스키마(WP0 #3 미해결)라 추가 enum 강제는 안 함.

### 3.3 `pipeline.ts` — 오케스트레이터
```ts
export interface DecomposeResult { workPackages: WorkPackage[]; coverage: CoverageMatrix }
export async function runDecomposition(intent: string, deps: StageDeps): Promise<DecomposeResult>
```
- 4단계 순차 호출 → `coverageMatrix(stories.map(s=>({storyId, deliverableIds})), deliverables)`(보고용) → story×role 전개 → `LlmWorkPackage[]` → 기존 `toWorkPackages`.
- 빈 전개(story 0 등)면 `toWorkPackages(fallback(intent))`로 단일 WP 보장.
- coverage는 호출자(producer)가 로그.

### 3.4 `producer.ts` 수정
- `produceDecomposition`: 단일 `callClaudeText`+`parseLlm` 대신 `runDecomposition(intent, {claude, model, timeoutMs})`.
- 결과 `workPackages`로 기존 envelope/publish 경로 그대로. coverage는 `console`/로거로 gaps/overlaps/unknown 카운트 요약.
- 단계가 각자 degrade하므로 producer 레벨 try/catch는 최종 안전망(전체 throw → `toWorkPackages(fallback)`)으로 유지.
- 기존 `DECOMPOSE_SYSTEM_PROMPT`·`parseLlm`·`fallback`은 단계로 이동·세분화하되, `LlmWorkPackage`·`toWorkPackages`(map.ts)는 **불변 재사용**.

### 3.5 `config.ts`
- `CLAUDE_TIMEOUT_MS`(기본 120000)·decompose max_tokens 단계별 상수를 config로. process.env 직접 읽기 제거.

## 4. graceful degradation 사다리 (P2-2 "빈 emit 금지" 계승)

| 실패 단계 | degrade |
|---|---|
| epics | 단일 epic = intent |
| slice | 각 epic = 1 story(claims 빈, AC=[epic.title]) |
| deliverables | `[]` (매트릭스가 전 claim을 unknown 보고 — 3a 로그만, emit 진행) |
| roles | story당 `['developer']` |
| 전체 붕괴 | `toWorkPackages(fallback(intent))` 단일 WP |

→ 어떤 경로에서도 ≥1 WP emit. **빈 발행 0**(P2-2 불변식 보존).

## 5. 결정론 경계 (불변식, §6 설계 규칙)

- **LLM** = 의미 판단만: epic 식별·INVEST 세로 슬라이싱·deliverable 도출·역할 판정.
- **순수 코드** = 커버리지 매트릭스(P2-1)·content-hash ID(P2-1)·ref→id 리맵(기존 map.ts)·story×role 전개.
- LLM 응답은 모두 `{epics:[...]}`·`{stories:[...]}`·`{deliverables:[...]}`·`{assignments:[...]}` **래핑 오브젝트**로 통일(기존 brace-추출 파싱 재사용·일관).

## 6. 테스트 계획

- **단계별**(`epics`/`slice`/`deliverables`/`roles`.test.ts): mocked `ClaudeLike`로 happy(정상 JSON) + degrade(throw·빈·검증 실패) 각각.
- **run-stage.test.ts**: 제네릭 파싱·펜스/중괄호 추출·fallback 경로.
- **pipeline.test.ts**: staged JSON(단계별 다른 응답)을 주는 mock claude로 end-to-end → WP[]·coverage 단언. claims↔deliverables gap/overlap 케이스 포함.
- **producer.test.ts**(갱신): 4단계 통합 후에도 emit 페이로드가 `DecompositionEmittedSchema` 정확 일치·fallback 단일 WP 유지.
- **flag-off 회귀 0**: 기존 trigger/sessions.route 테스트 무수정 통과.
- build·`pnpm audit` 0·jscpd 0 clones.

## 7. 위험 & 완화

| 위험 | 완화 |
|---|---|
| 4단계 보일러플레이트 CPD 클론 | `run-stage.ts`로 call+parse+degrade 1곳 공통화 |
| 단계 부분 실패로 빈/불완전 emit | 단계별 degrade 사다리 + producer 최종 fallback (빈 emit 0) |
| LLM 호출 4배 → 지연/비용 | 배치(epic·story 단위 N+1 아님 고정 4호출). 후속 캘리브레이션 대상(§19 비차단) |
| emit 페이로드 계약 드리프트 | 페이로드 불변({workPackages}), coverage 로그 전용. producer 스키마 일치 테스트 |
| `coverageMatrix`에 빈 deliverables | 순수 함수가 gaps=[]·unknownClaims=전 claim 보고(throw 없음). 3a 로그만 |

## 8. P2-3b 인터페이스 (후속 슬라이스가 이어받을 지점)

3a가 `pipeline.ts`에서 stories·deliverables·coverage를 이미 산출하므로, 3b는:
- P4 repair 루프: `coverageMatrix` gaps/overlaps를 `llm_repair(stories, gaps, overlaps)`에 넘겨 K회 반복 → 수렴 시 진행, 소진 시 producer에서 에스컬레이션(P1d-2 소비자의 `decomposition.inconsistent`는 emit *후* 구조/사이클용 → 3b는 emit *전* repair 소진용 별도 경로 필요).
- P5 세로슬라이스 린트: roles 결과로 story당 직능 수 검사(=1이면 재슬라이싱 후보 소프트 린트).
- (선택) coverage를 emit 페이로드/관측 이벤트로 surface.
