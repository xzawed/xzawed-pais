# P4 impact 채널 (N8) 1차 — golden differential 설계

> 원천: `docs/senario/xzawedPAIS_handoff_spec.md` §9(검증 3렌즈)·§10(릴리스 게이트)·`docs/senario/VERIFICATION_ADVERSARIAL_STRATEGY.md` §7. 충돌 시 사양 우선.

## 목적

검증 3채널(spec §9)의 셋째 렌즈 **impact**의 첫 슬라이스 = **golden differential**. develop_code WP 산출물이 **사람이 사인오프한 golden 기준 출력에서 벗어났는지**(behavioral drift)를 실행으로 검증한다. drift면 blocking(완료 미발행). 미소비로 남아 있던 oracle `golden_refs`(migration 010)를 처음으로 소비하고, **N7(골든 자동 갱신 금지·사람 승인만)** 의 load-bearing 가드를 활성화한다.

선행 #292(advisory 채널 N3)는 impact의 advisory 갈래(결합도 냄새)를 받을 큐를 이미 제공한다 — 이 슬라이스는 impact의 **blocking 갈래(golden differential)** 만 담당한다.

## 범위

**포함**: 승인 oracle의 `golden_refs`를 실행 ground truth로 소비하는 blocking golden-differential 검증을 `verifyWp`에 additive hard-AND로 추가. P4b-2 conformance의 author→run 기계를 `runAuthoredCheck`로 일반화해 재사용(CPD 회피).

**제외(후속·의존성 명시)**:
- affected-story 회귀 재실행 + 결합도-냄새 → advisory(#292) 라우팅 (의존성 DAG blast-radius·파일 변경 추적)
- golden 초안 생성(P3-2 scenario 초안처럼 PM이 golden 후보 제안)
- property 채널(invariants 소비)
- mutation θ_risk 게이트(N8 강화)

## 배경 — 왜 golden differential이 첫 슬라이스인가

기존 `verifyWp`는 develop_code WP에 대해 **이미 full 빌드+테스트를 재실행**한다(P4b-1). 따라서 "변경이 시블링 테스트를 깬다(breaks-passing-work)"는 이미 correctness 게이트가 `failed===0` 요구로 차단한다. impact 렌즈가 **추가로** 잡는 것은 (a) 테스트 스위트가 커버하지 못하는 **golden 기준 동작 표류**, (b) 결합도 냄새(advisory·후속). (a)가 자기완결적·고가치·N7 활성화라 첫 슬라이스로 택했다.

## golden 데이터 (이미 영속됨)

`db/oracle.types.ts` `OracleGoldenSchema`:
```
{ id, inputFixture, normalizedOutput, normalizers[], frozenAt, frozenBy, fromDecision, version }
```
- `inputFixture` — 기준 입력. `normalizedOutput` — 사인오프 시점 정규화 출력(기대값). `normalizers[]` — 비결정 필드 제거 규칙 서술(타임스탬프·id 등).
- 승인 oracle(status=approved)에 임베드. 사람이 `PATCH /oracles/:id/approve`(body의 golden_refs)로만 생성/갱신(N7).

## 아키텍처 — author→run (N1 실행 근거)

"impl을 fixture로 실행해 출력 비교"는 산출물별 호출 글루가 필요하므로 develop_code 에이전트가 작성한다(P4b-2 conformance와 동일 패턴·N6 독립 컨텍스트). 결정론 harness는 일반 impl 호출 불가라 비채택.

```
verifyWp(develop_code, ...)
  ① judgePrimaryResult (P4b-1)
  ② planVerificationChecks 파생 빌드·테스트 (P4b-1)
  ③ runConformanceCheck (P4b-2)            ─┐ 둘 다 runAuthoredCheck 사용
  ④ runImpactCheck (신규)                   ─┘
       → approvedGoldensForStory(wf, storyId)   미존재/빈 → skip(ok·회귀 0)
       → author(develop_code, 격리 세션 'impact-author'):
            `.xzawed/impact/<wpId>.*`에 differential 테스트 작성 —
            impl을 inputFixture로 실행 → normalizers 적용 → normalizedOutput과 동등 단언.
            구현 파일 수정 금지(프롬프트 지시).
       → selectAuthoredTestFiles(artifacts, IMPACT_DIR, wpId)  (좌측 앵커+테스트 확장자 필터)
            0개 → fail-closed('author가 테스트 미작성')
       → Tester(격리 세션 'impact-run')가 그 testFiles 실행
       → judgePrimaryResult('run_tests')  (passed>0 floor 포함 — vacuous 차단·N8)
  drift(불일치)·미작성·throw → fail = blocking(완료 미발행 → lease 백스톱 reclaim→escalate)
```
모든 채널 hard-AND. `runImpactCheck`는 **never-throw fail-closed**(불확실=실패·N1). impact 미활성/golden 부재면 skip → verifyWp는 P4b-2까지와 동일(회귀 0).

## N7 구조적 보장

impact 채널은 `approvedGoldensForStory`로 golden을 **읽기만** 한다. 채널에 golden 생성·UPDATE·INSERT 경로가 0이다. 신규 golden 버전은 오직 사람 `PATCH /approve`(기존 oracle.route·oracle.repo.upsert/approve)로만 생긴다 — 에이전트가 골든을 자동 갱신할 수 없다(N7 코드 수준). drift는 항상 blocking이며, 의도된 동작 변경이면 사람이 새 golden을 승인해 다음 실행에서 일치한다.

## 컴포넌트 설계

### 1. `db/oracle.repo.ts` — `approvedGoldensForStory`

```ts
/** 특정 story의 approved 오라클(최신 version)에서 golden_refs 반환. 승인 행 없음·golden 0개면 null(→ impact skip). */
async approvedGoldensForStory(workflowId, storyId): Promise<OracleGolden[] | null> {
  // SELECT golden_refs FROM oracles WHERE wf=$1 AND story=$2 AND status='approved' ORDER BY version DESC LIMIT 1
  // OracleGoldenSchema.array().parse(row.golden_refs); 빈 배열이면 null
}
```
`approvedOracleForStory` 패턴(불량 JSON throw→상위 fail-closed).

### 2. `streams/conformance.ts` — 일반화 + golden plan

- `selectConformanceTestFiles(artifacts, wpId)`를 `selectAuthoredTestFiles(artifacts, dir, wpId)`로 일반화 — `selectConformanceTestFiles`는 `selectAuthoredTestFiles(_, CONFORMANCE_DIR, _)`로 위임(기존 API·호출자 보존·좌측 앵커+TEST_FILE_RE 불변).
- `IMPACT_DIR = '.xzawed/impact'`·`impactStem(wpId)`.
- `buildGoldenDiffAuthorPlan(wp, goldens)` — golden별 inputFixture·normalizers·기대 normalizedOutput을 번호 매겨 나열 + "impl을 fixture로 실행·normalizers 적용·normalizedOutput과 동등 단언하는 실행 가능 테스트를 `<IMPACT_DIR>/<wpId>.*`에 작성·구현 수정 금지" 지시·4000 클램프.
- `ImpactOracleStore` 포트(`approvedGoldensForStory`).

### 3. `streams/verify.ts` — `runAuthoredCheck` 추출 + `runImpactCheck`

- 기존 `runConformanceCheck`의 author→run 골격(workspaceRoot 가드·핸들러 가드·execConformanceStep author·selectFiles·execConformanceStep run·judge)을 `runAuthoredCheck(wp, deps, cfg)`로 추출. `cfg = { dir, authorSuffix, runSuffix, baseline: () => Promise<unknown|null>, buildPlan: (baseline) => string }`. baseline null → skip(ok).
- `runConformanceCheck` = `runAuthoredCheck` with conformance cfg(approvedOracleForStory·buildConformanceAuthorPlan·CONFORMANCE_DIR).
- `runImpactCheck` = `runAuthoredCheck` with golden cfg(approvedGoldensForStory·buildGoldenDiffAuthorPlan·IMPACT_DIR).
- `VerifyDeps`에 `impactEnabled?` 추가(oracleStore는 이미 존재·`ImpactOracleStore` 포함하도록 타입 교차).
- `verifyWp`: 파생 체크 후 `tool==='develop_code'`이면 conformance → impact 순서로 hard-AND.

### 4. `streams/worker.ts` — `WorkerDeps.impactEnabled?`

verifyEnabled 경로의 `verifyWp` deps에 `impactEnabled` 합류. impact 실패도 conformance와 동일 완료 미발행 → lease 백스톱.

### 5. 배선 `streams/supervisor.ts` · `server.ts` · `config.ts`

- `SupervisorConfig.wpImpact?`·`buildWorkerConsumerDeps`가 `impactEnabled = config.wpImpact === true && deps.oracleStore != null`(행동 단언).
- `MANAGER_WP_IMPACT`(기본 false·가역) — 전제 `MANAGER_TASK_WORKER`+`MANAGER_WP_VERIFY`+OracleRepo(`MANAGER_ORACLE_DOR`||`MANAGER_ORACLE_DRAFT`). off면 conformance까지와 동일(회귀 0).
- server.ts: oracleStore 생성 조건에 `MANAGER_WP_IMPACT` 추가·`wpImpact` 전달·오진 경고(WP_VERIFY off·oracleStore 부재·가시성 하한 — impact는 WP당 호출 +2(author+run)이라 conformance와 합쳐 최대 7단계 → 가시성 권장 상향).

## 수용 테스트

- **golden 일치**: author 테스트가 통과(passed>0·failed=0) → impact ok → 완료.
- **golden drift**: author 테스트 실패(normalizedOutput 불일치) → impact fail → 완료 미발행.
- **승인 golden 없음**: approvedGoldensForStory null → skip(ok) → 회귀 0.
- **author 미작성**: selectAuthoredTestFiles 0개 → fail-closed.
- **never-throw**: golden 조회·author·run throw → fail verdict(불확실=실패).
- **impact off**: conformance까지만 동작(회귀 0).
- **일반화 동치**: `runAuthoredCheck` 추출 후 기존 conformance 테스트 전부 무수정 통과.
- **N7**: impact 채널 경로에 golden write/INSERT/UPDATE 0(grep 단언).

## 불변식 self-check (spec §1)

- N8 ✅ (golden 기준 동작 검증 — 스위트가 못 잡는 표류 차단)
- N7 ✅ (golden 읽기만·자동 갱신 0·사람 승인만)
- N1 ✅ (실행 테스트 결과로만 판정·LLM 선언 불가)
- N6 ✅ (author는 사람 승인 golden을 인코딩·독립 세션)
- N3 ✅ (advisory 비차단 분리 보존 — 이 슬라이스는 blocking만 추가)
- 회귀 0 ✅ (flag off·golden 부재면 P4b-2까지와 동일)

## 잠재 리스크 / 후속

- golden_refs는 현재 실제로 비어 있음(초안 생성기 없음) → 채널은 사람이 golden 추가 전까지 휴면(conformance가 오라클 승인 전 휴면이던 것과 동일). golden 초안 생성은 후속.
- author Developer는 구현자와 같은 모델군(독립 세션·사람 승인 golden 단언으로 경계) — P4b-2와 동일 정직한 한계.
- WP당 에이전트 호출 증가(conformance+impact = 최대 7단계) → 가시성 타임아웃 상향 권장(경고).
