# P4b-2 — 오라클 conformance 검증 (step-def 컴파일 thin 슬라이스) 설계

날짜: 2026-06-10
선행: P4b-1 검증 게이트(#273, [2026-06-10-p4b-1-verification-gate-design.md](2026-06-10-p4b-1-verification-gate-design.md) §1 비범위 "오라클 시나리오 step-def 컴파일 — 4b-2")
범위: **xzawedManager 단독** (xzawedShared·에이전트 서비스·핸들러 계약 무수정)
senario 근거: `ORACLE_SCHEMA.md`(§intro step-def 컴파일·§3 시나리오·§8 DoR), `VERIFICATION_ADVERSARIAL_STRATEGY.md` §1(conformance=blocking)·§2(스펙 유래 케이스)·§5(fail-closed·N6 독립성)·§7(conformance 채널), ROADMAP Phase 4(N1·N6)

## 1. 목표 / 비범위

**목표**: develop_code WP 검증에 **사람 승인 오라클 GWT 시나리오를 실행 ground truth로 소비**하는 conformance 채널을 추가한다. P4b-1의 N6 한계(게이트 통과가 구현자의 `package.json scripts`에서 파생된 명령에만 의존 — 작성자가 검증 명령을 통제)를 봉합한다: 게이트가 **사람이 승인한 동작**에 묶인, 구현자와 독립된 검증 테스트의 **실 실행 결과**에 의존하게 만든다(N1: 실행 결과만 통과 성립·LLM 선언 불가).

**핵심 통찰(senario §intro)**: 사람이 읽고 승인하는 것은 *시나리오*, 실제 실행되는 것은 *step-def 바인딩*이다. 평문 GWT를 실행 테스트로 만드는 바인딩 *생성*은 코드 생성 주체가 해야 하며(이 시스템에선 Developer 에이전트), 독립성(N6)을 위해 **구현 호출과 분리된 새 호출**이 *사람 승인 시나리오·계약·산출물만* 보고 작성한다.

**비범위(후속 슬라이스)**:
- mutation 게이트·θ_risk·빈 스위트 vacuous pass 봉합 — 4b-3(N8).
- invariants·golden_refs 컴파일 + `OracleScenarioSchema` 구조 확장(step_defs·binds_to·구조화 params) — 4b-3(구조 갭 #2).
- advisory 큐·impact 회귀 채널 — 4b-3(N3).
- security(STRIDE)·designer 산출물 검증 — 4d.
- 검증 실패 사유를 재실행 입력에 주입하는 informed rework·attribution_counters — 4c.

## 2. 핵심 결정

| # | 결정 | 근거 |
|---|------|------|
| 1 | conformance는 P4b-1 파생 체크 **위에 additive hard-AND**(②build→③run_tests→④conformance, fail-fast). ②(dev의 package.json 테스트)는 **유지** | 가장 효율적·회귀 0. package.json 테스트는 남되 단독 load-bearing이 아니게 됨(필요조건). conformance가 package.json 게이밍(`scripts.test: "echo passed"`)을 잡음 — N6 한계의 실질 봉합 |
| 2 | conformance는 **develop_code WP에만** 적용. run_tests/build_project WP는 자기 결과가 ground truth(이중 실행 회피)·design/security는 4d | P4b-1 `planVerificationChecks` 대칭. 오라클은 story 단위이고 develop_code가 story를 구현 |
| 3 | 바인딩 생성 = **구현과 분리된 새 develop_code 호출**(격리 세션·plan에 승인 GWT+계약만·구현 수정 금지 지시) → 테스트 파일 작성. 실행 = **Tester `testFiles`** | 각 에이전트 제 역할(Developer 생성·Tester 실행). 기존 핸들러 계약 그대로(run_tests `testFiles?`·develop_code `artifacts[]` 이미 존재) → 에이전트 서비스 무수정. bounded N6(신규 컨텍스트·사람 앵커 단언) |
| 4 | 승인 오라클 부재(이 story) → conformance **skip**(P4b-1 동작) | 회귀 0. `MANAGER_ORACLE_DOR` 동반 시 미승인 WP는 디스패치 자체가 안 되므로 갭이 닫힘; DoR off면 conformance는 "있을 때만" best-effort |
| 5 | `oracleStore` 미주입(flag 오설정) → conformance skip + 기동 경고. WP별 실패로 brick하지 않음 | 채널 부재 ≠ 불확실(P4b-1 결정 #5). 전역 설정 결함은 기동 경고로 가시화 |
| 6 | author·run 호출은 P4b-1 `verifySessionId` 패턴의 **별 suffix 격리 세션**(`-conf-author`·`-conf-run`) | RPC 응답 무상관(스트림 위치+type) — attempt·단계 간 좀비 응답 오귀속 차단(N1 false-pass 방지) |
| 7 | flag `MANAGER_WP_CONFORMANCE`(기본 false), 전제 `MANAGER_TASK_WORKER`+`MANAGER_WP_VERIFY`+`oracleStore`(=`MANAGER_ORACLE_DOR\|\|MANAGER_ORACLE_DRAFT`로 OracleRepo 생성) | off면 P4b-1과 바이트 동일·회귀 0. 기존 flag 사다리 패턴 |
| 8 | author가 테스트 파일을 안 만들거나(artifacts에 conformance 파일 없음)·실행 실패·파싱 실패 = **fail-closed**(verification_failed) | 불확실=실패(N1). 부재한 completion이 load-bearing → lease 백스톱 reclaim→escalate(N5, P4b-1 그대로) |

## 3. 데이터 흐름 (`MANAGER_WP_CONFORMANCE` on · develop_code WP)

```
handleWpDispatchSignal → handler.execute(input, wf, uc)         # 기존 구현 호출(P4-1/4a-2)
  → verifyWp(tool='develop_code', wp, result, deps):
      ① judgePrimaryResult                                       # P4b-1, develop_code는 ok
      ② 파생 체크: build_project → run_tests (dev package.json)  # P4b-1
      ③ [신규] conformance(oracleStore 주입 & develop_code일 때):
         - oracle = oracleStore.approvedOracleForStory(wf, wp.storyId)
         - oracle == null → conformance skip → ok (회귀 0)
         - workspaceRoot 미영속 → fail-closed (기존 가드 재사용)
         - a. authorResult = handlers['develop_code'].execute(
                 buildConformanceAuthorInput(wp, oracle.scenarios, uc),
                 verifySessionId(wf, wpId, attempt, 'conf-author'), uc)
         - b. files = selectConformanceTestFiles(authorResult.artifacts, wpId)
              files.length === 0 → fail-closed
         - c. runResult = handlers['run_tests'].execute(
                 { ...buildWorkerInput(wp, uc), testFiles: files },
                 verifySessionId(wf, wpId, attempt, 'conf-run'), uc)
         - d. judgePrimaryResult('run_tests', runResult)          # 기존 minimal Zod 재사용
  → ①②③ 모두 ok → wp.completion → DONE → 후행 재디스패치
  → 임의 실패     → 완료 미발행 + wp.verification.failed{reason} → lease reclaim→escalate
```

## 4. 변경 상세 (전부 xzawedManager)

- **`db/oracle.repo.ts` — `approvedOracleForStory(workflowId, storyId)` 추가(additive)**:
  `SELECT scenarios, coverage FROM oracles WHERE workflow_id=$1 AND story_id=$2 AND status='approved' ORDER BY version DESC LIMIT 1`.
  없으면 `null`. 있으면 `{ scenarios: OracleScenario[] (human_approved만 필터), coverage }`.
  `OracleScenarioSchema.array().parse`로 재검증(불량 레거시 JSON throw→상위 fail-closed). 기존 `approvedByWorkflow`(satisfied-set용)와 별개·무수정.

- **`streams/conformance.ts`(신규·순수)**:
  - `CONFORMANCE_DIR = '.xzawed/conformance'`.
  - `buildConformanceAuthorPlan(wp, scenarios): string` — 승인 GWT(given/when/thenSteps)를 번호 매겨 나열 + "다음 사람 승인 동작을 검증하는 **실행 가능한 테스트**를 `<CONFORMANCE_DIR>/<wpId>.*`(프로젝트 테스트 프레임워크에 맞춰)에 작성하라. **구현 파일을 수정하지 말라**. 시나리오의 단언만 인코딩하라." 지시. plan은 4000자 클램프(planner/developer 정합).
  - `buildConformanceAuthorInput(wp, scenarios, userContext)` — `buildWorkerInput` 형태 재사용하되 `plan`=author plan(develop_code는 `plan` 구동).
  - `selectConformanceTestFiles(artifacts, wpId): string[]` — `artifacts` 중 `CONFORMANCE_DIR/wpId` 접두 + 테스트 확장자(.test.·.spec.·_test.·test_·.py 등) 필터. 결정론.

- **`streams/verify.ts`**:
  - `VerifyDeps`에 `oracleStore?: { approvedOracleForStory(wf, storyId): Promise<{scenarios; coverage} | null> }`·`conformanceEnabled?: boolean` 추가(둘 다 optional·기본 미동작).
  - `runConformanceCheck(wp, deps): Promise<VerificationVerdict>`(**never-throw**·fail-closed): oracleStore/conformanceEnabled 부재→`{ok:true}`(skip). oracle null→`{ok:true}`(skip). workspaceRoot 부재→fail. author execute throw·artifacts 빈 테스트→fail. run execute throw→fail. `judgePrimaryResult('run_tests', runResult)` 반환. author/run은 `'conf-author'`/`'conf-run'` suffix 격리 세션.
  - `verifyWp`: 기존 ①② 후 `tool==='develop_code'`이면 `runConformanceCheck` 호출(ok 아니면 즉시 반환).
  - `verifySessionId`에 4번째 옵셔널 `suffix` 인자 추가(`{wf}-verify-{wpId}-{attempt}[-{suffix}]`) — P4b-1 기존 호출(suffix 없음) 바이트 동일.

- **`streams/worker.ts` / `supervisor.ts`**: `buildWorkerConsumerDeps(deps, config)`(P4b-1 D4 헬퍼)가 `conformanceEnabled = config.wpConformance && deps.oracleStore != null`·`oracleStore`를 verify deps에 합류(행동 단언). `SupervisorConfig.wpConformance?`·`SupervisorDeps.oracleStore?`(P3-1 기존) 사용.

- **`config.ts`**: `MANAGER_WP_CONFORMANCE`(기본 false) 파싱. 주석에 전제(`MANAGER_TASK_WORKER`+`MANAGER_WP_VERIFY`+OracleRepo)·**가시성 하한 상향**(conformance 시 develop_code WP당 에이전트 호출 최대 4회 ≈ 4×120s → `MANAGER_LEASE_VISIBILITY_MS` ≥ 600s 권장) 명시.

- **`server.ts`**: `OracleRepo` 생성 조건에 `MANAGER_WP_CONFORMANCE` 추가(`pool && (ORACLE_DOR||ORACLE_DRAFT||WP_CONFORMANCE)`)·`wpConformance: config.MANAGER_WP_CONFORMANCE`를 SupervisorConfig 전달·기동 경고 **3종**: ①conformance on인데 `MANAGER_WP_VERIFY` off(conformance는 `verifyWp` 안에서만 동작 → WP_VERIFY 없으면 무음 no-op·검증 게이트 경고 패턴 연장·구현 시 추가) ②conformance on인데 oracleStore 부재(항상 skip) ③`visibilityMs < 600_000`(WP당 호출 최대 5단계).

- **migration 없음·신규 테이블 없음·핸들러 계약 무수정** — run_tests `testFiles?`·develop_code `artifacts[]`는 이미 존재. 이벤트·재시도는 P4b-1 기계 재사용.

## 5. 회귀 0 논거

- `MANAGER_WP_CONFORMANCE` off(기본) → `runConformanceCheck` 즉시 skip(`conformanceEnabled` false) → 워커·verify 동작 P4b-1과 바이트 동일.
- `MANAGER_WP_VERIFY`/`MANAGER_TASK_WORKER` off → 검증/워커 자체 미배선(상위 게이트 보존).
- `approvedOracleForStory`·`conformance.ts`는 신규·격리. `verifySessionId` suffix는 trailing optional(기존 호출 불변).
- 승인 오라클 부재 story → skip(P4b-1 경로).

## 6. 에러 처리 / fail-closed

`runConformanceCheck`는 never-throw. fail verdict 사유: workspaceRoot 부재 / author execute throw / author가 conformance 테스트 미생성 / run execute throw / run 결과 파싱 실패 / `success=false || failed>0`. fail이면 `verifyWp`가 fail 반환 → 워커가 완료 미발행 + `wp.verification.failed`(best-effort) → lease 만료 → reclaim attempt++ → 상한 ESCALATED(사람 도달은 lease 상태머신, P4b-1 §결정 #4 그대로).

## 7. 알려진 한계 (정직 문서화)

- **vacuous conformance**: 새 Developer 호출이 빈/약한 테스트를 작성하면 `failed:0`으로 통과(false-pass). 4b-3 mutation 게이트(N8)가 봉합. 본 슬라이스에서 `passed≥1` 강제는 프레임워크·언어별 카운트 신뢰성 문제로 보류(4b-3에서 N8과 함께).
- **동일 모델군 맹점(N6 §8)**: author Developer는 구현자와 같은 모델군 — 신규 컨텍스트·사람 승인 단언으로 *경계*하나 제거하지 못함. 산출물만 보는 **읽기전용 워크스페이스 마운트**(author가 구현 수정 못 하게)는 후속.
- **author의 구현 수정 가능성**: "구현 수정 금지"는 프롬프트 지시일 뿐 강제 아님 — author가 구현을 바꿔 테스트를 통과시킬 위험. 위 읽기전용 마운트로 후속 해소. 본 슬라이스는 프롬프트 + 단언이 사람 동작에 앵커된다는 사실로 경계.
- **평문 GWT 해석**: 구조화 params/step_defs 부재(스키마 미확장) — author LLM이 자유 텍스트 step을 해석. 충실도는 승인 시나리오 문구 품질에 의존(4b-3 스키마 확장에서 강화).
- **비용/지연**: develop_code WP당 에이전트 호출 최대 4회(build·dev-test·author·conformance-run) — lease 가시성 상향 필요(기동 경고). 타임아웃은 RedisAgentHandler 하드코딩 120s(운영 조정 수단 부재는 기존 부채).
- **관측 이벤트 무소비**: `wp.verification.failed`는 `manager:events:{wf}` 소비자 미배선(P4b-1 부채) — 사람 도달은 ESCALATED(lease). 사람 접점 UI 슬라이스에서 연결.

## 8. 테스트 전략

- **conformance.test.ts**(순수): author plan에 승인 GWT 전부 포함·"구현 수정 금지" 문구·convention 경로 / `selectConformanceTestFiles` 필터(테스트 파일만·wpId 접두·비테스트 artifact 제외) / 4000 클램프.
- **verify.test.ts**: conformanceEnabled false→skip / oracleStore 부재→skip / oracle null→skip(→ ②까지만으로 ok) / workspaceRoot 부재→fail / author throw→fail / author 테스트 미생성→fail / run fail→fail / 전체 통과→ok / author·run 격리 세션 키(suffix) 구별 단언.
- **worker.test.ts**: flag off→기존 테스트 무수정 통과(회귀 0) / on+conformance fail→완료 미발행+이벤트+outcome verification_failed / on+통과→완료 발행.
- **supervisor.test.ts**: `buildWorkerConsumerDeps` 행동 단언(wpConformance×oracleStore 유무→conformanceEnabled 진리표).
- **oracle.repo 통합(skip-if-no-DB)**: approved 오라클 upsert→`approvedOracleForStory`가 human_approved 시나리오·최신 version 반환·미승인/타 story→null.
- **execution-worker.integration(skip-if-no-DB) 확장**: approved 오라클 존재 → mock develop_code(테스트 파일 artifacts 반환) → mock run_tests(success) → DONE / run 실패 → 완료 미발행 → `handleLeaseSweep` reclaim(워크플로 스코프 래퍼).
