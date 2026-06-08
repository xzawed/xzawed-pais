# P2-3b 분해 자가수선 (P4 repair 루프 + 세로슬라이스 린트) 설계

- 날짜: 2026-06-09
- 서비스: `xzawedManager`(packages/server)
- 로드맵: senario ROADMAP Phase 2 — **PM Agent 분해 파이프라인**. P2-1 결정론 코어(#263)·P2-2 스켈레톤(#264)·P2-3a 다단계 생성(#265) 다음. P2-3의 두 번째(마지막) 슬라이스.
- 선행 사양: `xzawedPAIS_handoff_spec.md` §6(분해 파이프라인 P4 자기수선 루프·P5 세로슬라이스 린트)·§19(캘리브레이션 파라미터) · `2026-06-08-p2-3a-decomposition-generation-design.md`.

## 1. 목표 & 비범위

3a의 다단계 생성([[2026-06-08-p2-3a-decomposition-generation-design]])에 **자가수선**을 더한다:
1. **P4 커버리지 매트릭스 repair 루프** — `coverageMatrix`(P2-1, 순수)가 gaps/overlaps를 보고하면 `repairStories`(LLM)로 stories를 수선하고 재검증, **K회까지 반복**. 수렴(gaps∪overlaps 비어있음) 시 진행, **소진 시 `decomposition.inconsistent`(reason `'coverage'`)로 에스컬레이션·WP 미발행**.
2. **세로슬라이스 소프트 린트** — roles 후 한 story가 정확히 한 직능으로만 매핑되면(수평 분해 의심) 순수 함수로 식별·로그(advisory, 흐름 무영향).

**PO 결정(2026-06-09)**:
1. **수렴 실패 = 에스컬레이션(§6 충실)** — repair 소진 시 `decomposition.emitted` 대신 `decomposition.inconsistent`(신규 reason `'coverage'`, gaps/overlaps detail 동반)를 `manager:events:{workflowId}`에 발행, WP 미발행. 기술적 degrade 폴백(단일 WP)과 구분 — 의미 불일치는 진행하지 않고 사람에게 권위 위임(M2/N6).
2. **린트 = 순수 함수 + 로그** — §6 'soft·재슬라이싱 후보' 충실. 자동 재슬라이싱은 별도(후속). LLM 미호출(결정론 경계 유지).
3. **K 기본 2** — `MANAGER_DECOMPOSE_REPAIR_MAX`(config 오버라이드). §19 캘리브레이션 파라미터(비차단).
4. **에스컬레이션 사용자 통지** — 머신 신호(`decomposition.inconsistent`)에 더해 trigger가 `task_complete`에 에스컬레이션 사유를 담아 사용자 통지(별도 error/게이트 흐름은 과함).
5. **한 PR** — 자가수선(repair 루프 + 린트)은 응집된 한 슬라이스.

**범위(이 슬라이스)**:
- `decompose/stages/repair.ts` — `repairStories`(LLM 수선 단계).
- `decompose/lint.ts` — `singleRoleStoryIds`(순수 소프트 린트).
- `decompose/pipeline.ts` 수정 — repair 루프 + 린트 + `DecomposeResult` 판별 유니언(ok|inconsistent).
- `decompose/producer.ts` 수정 — 결과 분기(ok→emitted / inconsistent→inconsistent 발행 / 기술 throw→fallback).
- `decompose/trigger.ts` 수정 — escalated 분기 task_complete 메시지.
- `streams/decomposition-consumer.ts` 수정 — `InconsistentReason`에 `'coverage'` 추가(단일 출처).
- `stages/slice.ts` 수정 — `StoriesSchema`/`StoryItemSchema` export(repair 재사용·CPD 회피).
- `config.ts` 수정 — `MANAGER_DECOMPOSE_REPAIR_MAX`(기본 2) + server.ts 전달.
- 단위 테스트 + flag-off 회귀 0.

**비범위(후속, 엄격 제외)**:
- 린트의 자동 재슬라이싱(소프트 신호만). → 후속.
- P6 간선 추론·P7 oracle/risk enrich·`mergeKeepInflight` 배선. → 별도.
- decomposition 이벤트 아웃박스 경유 발행. → 후속 하드닝.
- Orchestrator UX(에스컬레이션 카드 등). → 후속.

## 2. 데이터 흐름 (변경점 = pipeline 중앙)

```
intent
 → identifyEpics(P1) → sliceVertical(P2) → deriveDeliverables(P3)
 → [P4 repair 루프]:
       coverage = coverageMatrix(stories→{storyId, deliverableIds}, deliverables)   # 순수
       iter = 0
       while ((coverage.gaps.length>0 || coverage.overlaps.length>0) && iter < K):
           stories  = repairStories(stories, deliverables, coverage, deps)            # LLM
           coverage = coverageMatrix(stories→claims, deliverables)                    # 순수 재검증
           iter++
       if (coverage.gaps.length>0 || coverage.overlaps.length>0):
           return { status:'inconsistent', coverage, reason:'coverage' }              # 소진→에스컬레이션
 → assignRoles(P5) → singleRoleStoryIds(roles)   # 순수 소프트 린트(로그)
 → story×role 전개 → toWorkPackages → { status:'ok', workPackages, coverage, singleRoleStoryIds }
```

- 루프 조건 = **gaps OR overlaps**(§6 충실). `unknownClaims`는 repair 입력 컨텍스트로 전달하되 수렴 조건엔 미포함(WP에 claim 미영속이라 발행 그래프에 무해).
- 수렴/소진 판정·K 카운트·루프 제어는 **순수 코드**. LLM은 `repairStories`에만.
- **degrade와의 상호작용**: deliverables가 빈 인벤토리(`[]`)로 degrade하면 gaps/overlaps 0 → 루프 미진입 → 정상 emit(3a 폴백 철학 보존). 전 LLM 동시 실패 시 deliverables도 비어 에스컬레이션 없이 단일 WP로 진행. 단 slice만 degrade(빈 claim stories)하고 deliverables는 성공한 부분 실패에서는 전(全)-gaps가 되어 repair 시도 후 미수선 시 에스컬레이션될 수 있다 — "일관 분해를 못 만들었다"는 정당한 사람-검토 상태로 수용.
- 3a의 emit 이후 흐름(봉투·스트림·Supervisor 소비)은 ok 경로에서 불변.

## 3. 모듈 변경

### 3.1 신규 `decompose/stages/repair.ts`
```ts
export async function repairStories(
  stories: Story[], deliverables: string[], coverage: CoverageMatrix, deps: StageDeps,
): Promise<Story[]>
```
- `runStage` 위임. 프롬프트에 현재 stories + `coverage.gaps`(미주장 산출물)·`coverage.overlaps`(중복 주장 storyIds 동반)·`coverage.unknownClaims`를 제시, stories의 deliverable claim을 재조정(갭 커버·중복 1개 story로·미지 claim 정리)한 **수정 stories** 반환.
- 응답 스키마 = slice의 `{stories:[...]}`와 동일 → `slice.ts`의 `StoriesSchema`·`StoryItemSchema`를 export해 재사용(CPD 회피).
- **degrade: 실패·빈 결과 시 입력 stories 그대로 반환** — 개선 없음 → 루프가 결국 소진 → 에스컬레이션(크래시 아님). 수선 불가도 사람 권위로 위임되는 안전 동작.

### 3.2 신규 `decompose/lint.ts`
```ts
/** §6 P5 소프트 린트: 정확히 한 직능으로만 매핑된 story id(수평 분해 의심·재슬라이싱 후보). 순수. */
export function singleRoleStoryIds(roles: Map<string, string[]>): string[]
```
- `roles` 항목 중 역할 배열 길이 1인 storyId를 사전순(`byId` 또는 정렬)으로 반환. map.ts와 같은 결의 순수 헬퍼.

### 3.3 `pipeline.ts` 수정
- `DecomposeResult` 판별 유니언:
```ts
export type DecomposeResult =
  | { status: 'ok'; workPackages: WorkPackage[]; coverage: CoverageMatrix; singleRoleStoryIds: string[] }
  | { status: 'inconsistent'; coverage: CoverageMatrix; reason: 'coverage' }
```
- `runDecomposition(intent, deps, repairMax)` — repair 루프 + 수렴/소진 분기 + roles·린트·전개. `fallbackWorkPackages`는 producer 기술-throw 경로에서 계속 사용(3a 불변).
- `repairMax`는 호출자(producer)가 config에서 주입(기본 상수).

### 3.4 `producer.ts` 수정
- `runDecomposition` 결과 분기:
  - `ok` → `decomposition.emitted`(payload `{workPackages}` 불변) 발행 + coverage·singleRoleStoryIds 로그. 반환 `{ emitted, escalated: false }`.
  - `inconsistent` → `decomposition.inconsistent`(reason `'coverage'`, payload `{reason, gaps, overlaps}`)를 `manager:events:{workflowId}`에 인과 봉투로 발행, WP 미발행. 반환 `{ emitted: 0, escalated: true }`.
  - 기술적 throw(catch) → `fallbackWorkPackages` 단일 WP emit(불변). 반환 `{ emitted, escalated: false }`.
- inconsistent 봉투: `correlationId=workflowId, causationId=null(원천), workflowId, stepId='decomposition.inconsistent', attemptId=0`. 스트림 `manager:events:{workflowId}`(consumer `defaultInconsistentStream`과 동일 규약).

### 3.5 `streams/decomposition-consumer.ts` 수정
- `InconsistentReason = 'cycle' | 'structural' | 'coverage'`(단일 출처). producer가 이 타입 import(계약 드리프트 회피).

### 3.6 `stages/slice.ts` 수정
- `StoriesSchema`·`StoryItemSchema` export(repair.ts 재사용).

### 3.7 `trigger.ts` 수정
- `produceDecomposition` 반환의 `escalated`로 task_complete content 분기:
  - 정상: `분해 완료: N WP emitted`.
  - escalated: `분해 불일치: 커버리지 수렴 실패 — 사람 검토 필요(에스컬레이션)`.

### 3.8 `config.ts` 수정
- `MANAGER_DECOMPOSE_REPAIR_MAX: z.coerce.number().int().positive().default(2)`. server.ts에서 producer deps로 전달.

## 4. 결정론 경계 (불변식, §6 설계 규칙)
- **LLM** = `repairStories`(의미 수선)만.
- **순수 코드** = `coverageMatrix`·루프 제어·수렴/소진 판정·`singleRoleStoryIds`·content-hash·전개.

## 5. 테스트 계획
- **repair.test.ts**: happy(수정 stories) · degrade(실패·빈→입력 불변).
- **lint.test.ts**: 역할 1개 story 식별 · 다역할/빈 제외 · 결정론 순서.
- **pipeline.test.ts**(확장): ①repair 불필요(첫 수렴) ②repair 1회 후 수렴 ③K 소진→`{status:'inconsistent', reason:'coverage'}` ④ok에 singleRoleStoryIds 포함. staged mock으로 coverage 상태 전이 재현.
- **producer.test.ts**(확장): ok→`decomposition.emitted`·emitted N / inconsistent→`decomposition.inconsistent` 발행·emitted 0·WP 미발행 / 기술 throw→fallback.
- **trigger.test.ts**(확장): escalated→에스컬레이션 메시지.
- **config.test.ts**(확장): `MANAGER_DECOMPOSE_REPAIR_MAX` 기본 2 + override.
- **flag-off 회귀 0**.

## 6. 위험 & 완화
| 위험 | 완화 |
|---|---|
| repair 루프 무한/비용 | K 상한(기본 2, config)·순수 수렴 판정·degrade는 입력 불변(개선 없음→소진) |
| repair가 새 inconsistency 유발 | 매 반복 후 `coverageMatrix` 재검증·미수렴 시 에스컬레이션 |
| inconsistent 발행 envelope이 consumer `emitInconsistent`와 CPD | 입력 차이(producer 원천·causation null) 존재; jscpd 적발 시 공용 빌더 추출 |
| 에스컬레이션 시 그래프 부재로 Supervisor 무동작 | 의도된 동작(§6 M2 사람 권위) — task_complete 메시지로 사용자 통지 |
| emit 계약 드리프트 | ok 경로 payload `{workPackages}` 불변(3a producer 스키마 테스트 보존) |

## 7. P2-3 완료 후 후속
P6 간선 추론 · 린트 자동 재슬라이싱 · P7 oracle(P3)/risk(Wiki Agent) enrich·`mergeKeepInflight` 배선 · 아웃박스 경유 발행 · Orchestrator 에스컬레이션 UX.
