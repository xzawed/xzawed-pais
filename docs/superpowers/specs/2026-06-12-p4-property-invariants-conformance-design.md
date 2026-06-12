# P4 property/invariants 기법 (conformance 렌즈) — 설계

- 날짜: 2026-06-12
- 상태: 설계 승인 대기
- 선행: P4b-2 conformance(#274 계열)·P4 impact golden-differential(#294, [2026-06-12-p4-impact-golden-differential-design.md](2026-06-12-p4-impact-golden-differential-design.md))·P4 advisory(#292, [2026-06-12-p4-advisory-channel-design.md](2026-06-12-p4-advisory-channel-design.md))
- 사양 출처: `docs/senario/xzawedPAIS_handoff_spec.md` §9, `docs/senario/VERIFICATION_ADVERSARIAL_STRATEGY.md` §2, `docs/senario/ORACLE_SCHEMA.md` §4 (충돌 시 사양 우선)

## 1. 배경·동기

### 1.1 용어 정정 — property는 4번째 채널이 아니다
사양 §9의 검증 모델은 **정확히 3 렌즈**다: **conformance**(동작 동일성·blocking/fail-closed)·**optimization**(더 나은 점→advisory 큐·비차단·N3)·**impact**(영향 범위·조건부). §9 conformance 행이 기재한 grounded method는 "의도 불변식→**property/golden 테스트**, 차등 테스트, 실행 트레이스↔의도 대조"다. 즉 **property/invariants는 conformance(차단) 렌즈 안의 한 기법**이며, 별도 채널이 아니다.

따라서 이 슬라이스는 **conformance 렌즈의 추가 기법** — 사람이 승인한 Oracle `invariants`(§4)를 실행 가능한 property-based 테스트로 컴파일해 `verifyWp`의 develop_code hard-AND에 additive로 넣는 것 — 이다. 이미 착륙한 conformance(P4b-2, GWT 시나리오=유한 예시)·impact(#294, golden=구체 입출력 픽스처)의 형제다.

### 1.2 미소비 invariants 컬럼 소비
`invariants` JSONB(migration 010 §4)는 영속되지만 **현재 어디서도 소비되지 않는다**(grep 확인: `oracle.types.ts` 스키마·`OracleRepo.upsert` 영속 경로·테스트에만 등장). `OracleInvariantSchema`(`{id, statement, domain, property, status}`)는 impact가 `golden_refs`를 소비하기 직전과 동일한 "베이스라인 대기" 상태다. 이 슬라이스가 migration 010의 마지막 미소비 컬럼을 닫는다.

### 1.3 invariant란 무엇인가 (ORACLE_SCHEMA §4)
invariant는 **사람이 진술한 보편 속성**(universal law over a generated input domain)이다:
- `statement` — 자연어(예: "발급 30분 경과 토큰은 항상 거부된다")
- `domain` — 입력 생성기 서술(예: "유효 토큰 생성기(발급시각 T, age 분포)")
- `property` — 준-형식 술어(예: "for all t: age(t) > 30min => reject(t)")
- `status` — `drafted | human_approved | rejected` (게이트는 `human_approved`만 계수)

이는 GWT 시나리오(유한 예시, `scenarios[]`)도 golden(구체 입력→정규화 출력, `golden_refs[]`)도 아니다. **임계 경계·생성 입력 도메인 위의 법칙**으로, 어떤 단일 예시·골든도 못 잡는 결함을 노린다.

## 2. 불변식 (반드시 충족)

| ID | 불변식 | 이 슬라이스에서의 적용 |
|---|---|---|
| N1 | 실행된 ground truth(LLM 선언 불가) | invariant를 실 실행 테스트로 컴파일→Tester 실행 결과 필드로만 판정(`judgePrimaryResult('run_tests')`). `runAuthoredCheck<T>` author→run 재사용. |
| N6/M2 | 사람 권위 | `human_approved` invariant만 게이트 계수. 에이전트는 draft만 가능(이 슬라이스는 draft 생성기 없음). |
| N7 | 오라클 읽기전용 | property 채널은 invariants를 **읽기만**(INSERT/UPDATE 0·grep-assertable). 신규 invariant는 사람 `POST/PATCH /oracles`로만. |
| N8 | 빈 껍데기 스위트 금지 | author가 0-test/빈 스위트면 fail-closed(`passed>0` floor·`selectAuthoredTestFiles` empty→fail). |
| — | fail-closed/never-throw | 모든 불확실(workspaceRoot 부재·author throw·테스트 미작성·run throw·run fail·baseline throw)→`{ok:false}`. |
| — | flag-off 회귀 0 | `MANAGER_WP_PROPERTY` off면 `verifyWp` 경로 바이트 동일. 승인 invariant 없음→skip(ok). |

## 3. 설계 결정

### D1. author plan 인코딩 = boundary + 명시 속성 단언 (PO 확정)
첫 슬라이스는 **결정론적 테스트만** 작성하게 한다: invariant의 임계값 주변 boundary-value 케이스(예: 30min ± ε) + 대표 입력의 속성 단언. **pbt 라이브러리 의존 0·무작위 0**. 이유: NL 도메인 서술+술어 문자열을 LLM이 정확한 fast-check 제너레이터로 번역하는 것은 오류 가능성이 크고(잘못된 제너레이터=거짓 통과, N1/N6 위반), golden-diff(#294)가 기계적이라 신뢰성이 높았던 것과 대비된다. property-based **fuzz**(risk-proportional iters)는 후속 슬라이스(§7).

### D2. verifyWp 합성 = 데이터 주도 순서 리스트 (A2·PO 확정)
현재 `verifyWp`의 develop_code 꼬리는 손으로 쓴 단락 체인이다:
```ts
if (tool === 'develop_code') {
  const conf = await runConformanceCheck(wp, deps)
  if (!conf.ok) return conf
  return runImpactCheck(wp, deps)
}
```
이를 **순서 리스트 단락-순회**로 교체한다:
```ts
if (tool === 'develop_code') {
  const channels = [runConformanceCheck, runImpactCheck, runPropertyCheck]
  for (const check of channels) {
    const verdict = await check(wp, deps)
    if (!verdict.ok) return verdict
  }
}
return { ok: true }
```
동작 보존(여전히 단락 hard-AND·기존 conf+impact 테스트가 안전망)·S3776 인지복잡도 증가 봉인·이후 채널(mutation 등) 추가가 리스트 1줄로 끝남. 탐색이 지적한 "꼬리가 채널마다 자람" 우려를 구조적으로 해소. **순서**: conformance→impact→property(기존 conf→impact 순서 보존·property를 끝에 append).

### D3. baseline = human_approved item 필터 (PO 확정)
golden(`approvedGoldensForStory`)은 per-item status 필터가 없지만(골든은 사인오프로 동결), invariant는 scenario처럼 per-item `status` enum이 있다. 따라서 `approvedInvariantsForStory`는 `approvedOracleForStory`(scenarios를 `human_approved`로 거름)를 미러링해 **`status === 'human_approved'` invariant만** 반환한다(M2/N6 — drafted/rejected는 게이트 미계수). 0개면 null→skip.

### D4. 휴면 출시 (impact와 동일)
`invariants`는 실무상 비어 있다(초안 생성기 없음 — P3-2는 GWT 시나리오만 draft). 이 슬라이스는 **draft 생성기를 만들지 않는다**. 사람이 `POST /oracles`(OracleRepo.upsert)로 invariant를 시드하기 전까지 채널은 휴면이다(impact가 golden_refs로 휴면인 것과 동일·범위 적정). flag-off 회귀 0 + flag-on이어도 베이스라인 없으면 skip.

**시딩 상태 주의**: `OracleRepo.approve()`는 scenario 항목만 `drafted→human_approved`로 전이하고 **invariant 항목 상태는 전이하지 않는다**(현재 invariants 보존). 이 슬라이스는 그 동작을 **건드리지 않는다**(approve() 무변경·기존 테스트 회귀 0). invariant는 초안 생성기가 없어 사람이 직접 저작하므로, 사람이 `POST /oracles` 시 invariant `status`를 직접 `'human_approved'`로 시드해야 게이트에 계수된다(`status` 생략 시 스키마 기본값 `'drafted'`→`approvedInvariantsForStory`가 필터로 제외·미게이트). scenario와의 이 비대칭은 저작 경로 차이(scenario는 P3-2 draft 가능→PATCH approve로 전이 / invariant는 사람 직접 저작→저작 시점에 승인)를 반영하며 의도적이다. 후속 invariant draft 생성기 슬라이스가 도입되면 그때 approve()에 invariant 전이를 추가한다.

## 4. 아키텍처 — 파일별 변경 (전부 manager-side·shared 무변경·새 migration 없음)

### 4.1 `db/oracle.repo.ts` — 베이스라인 리더
`approvedInvariantsForStory(workflowId, storyId): Promise<OracleInvariant[] | null>` 추가. `approvedGoldensForStory` + `approvedOracleForStory`의 status 필터 합성:
```ts
async approvedInvariantsForStory(workflowId: string, storyId: string): Promise<OracleInvariant[] | null> {
  const { rows } = await this.pool.query<{ invariants: OracleInvariant[] }>(
    `SELECT invariants FROM oracles
     WHERE workflow_id = $1 AND story_id = $2 AND status = $3
     ORDER BY version DESC LIMIT 1`,
    [workflowId, storyId, ORACLE_APPROVED],
  )
  const row = rows[0]
  if (!row) return null
  const invariants = OracleInvariantSchema.array().parse(row.invariants ?? []).filter((i) => i.status === SCENARIO_APPROVED)
  return invariants.length > 0 ? invariants : null
}
```
읽기전용(N7·INSERT/UPDATE 0). `OracleInvariantSchema`·`SCENARIO_APPROVED`(='human_approved') 재사용. 불량 레거시 JSON은 parse throw→상위 fail-closed.

### 4.2 `streams/conformance.ts` — 채널 시밍 추가
- `PROPERTY_DIR = '.xzawed/property'`(conformance/impact와 분리·테스트 충돌 방지) + `propertyStem(wpId)`.
- `InvariantOracleStore` 포트:
  ```ts
  export interface InvariantOracleStore {
    approvedInvariantsForStory(workflowId: string, storyId: string): Promise<OracleInvariant[] | null>
  }
  ```
- `buildInvariantAuthorPlan(wp, invariants): string` — 각 invariant의 `statement`/`domain`/`property`를 블록으로 렌더 + boundary+명시 속성 단언 지시 + "구현 파일 수정 금지" + `propertyStem(wp.id)` 경로 + 4000자 클램프(§5 상세).
- `selectAuthoredTestFiles`는 **그대로 재사용**(PROPERTY_DIR를 dir 인자로 전달) — 좌측앵커·TEST_FILE_RE 확장자 필터 무변경.

### 4.3 `streams/verify.ts` — 래퍼 + 합성
- `VerifyDeps.oracleStore` 타입을 `ConformanceOracleStore & ImpactOracleStore & InvariantOracleStore`로 확장 + `propertyEnabled?: boolean` 추가.
- `runPropertyCheck(wp, deps)` 래퍼(runImpactCheck 복제):
  ```ts
  function runPropertyCheck(wp: WorkPackage, deps: VerifyDeps): Promise<VerificationVerdict> {
    return runAuthoredCheck(wp, deps, {
      enabled: deps.propertyEnabled === true,
      dir: PROPERTY_DIR, authorSuffix: 'prop-author', runSuffix: 'prop-run',
      baseline: async () => (await deps.oracleStore?.approvedInvariantsForStory(deps.workflowId, wp.storyId)) ?? null,
      buildPlan: (invariants) => buildInvariantAuthorPlan(wp, invariants),
    })
  }
  ```
- `verifyWp` develop_code 꼬리를 D2 데이터 주도 루프로 교체.
- 세션 suffix `prop-author`/`prop-run`(conf-author/conf-run·impact-author/impact-run과 충돌 회피). `runAuthoredCheck`/`executeAuthoredTest`/`judgePrimaryResult`/`verifySessionId`는 무변경 재사용(skip·workspaceRoot 가드·no-test fail-closed·passed>0 floor·never-throw 전부 무료 상속).

### 4.4 `streams/supervisor.ts` — 행동 단언 배선
- `SupervisorConfig.wpProperty?` 추가.
- `buildWorkerConsumerDeps`: `propertyEnabled = config.wpProperty === true && deps.oracleStore != null`(행동 단언 — flag만 켜고 store 없으면 fail-closed disabled·무음 우회 방지)·oracleStore를 verify deps에 합류(conformance/impact와 공유).

### 4.5 `streams/worker.ts` — 스레딩
- `WorkerDeps.propertyEnabled?` 추가 → `runVerifyGate`의 `verifyWp` deps에 `propertyEnabled: deps.propertyEnabled === true` 합류(conformance/impact 대칭). property 실패도 기존대로 완료 미발행→lease 백스톱 reclaim→escalate(새 재시도 메커니즘 0).

### 4.6 `config.ts`·`server.ts` — flag·store·경고
- `config.ts`: `MANAGER_WP_PROPERTY: z.string().optional().transform((v) => v === 'true')`(default false·기존 flag 블록 복제).
- `server.ts`: oracleStore 생성 OR-조건에 `|| config.MANAGER_WP_PROPERTY` 추가(**공유 OracleRepo 재사용**·2번째 인스턴스 금지). `createSupervisor` config에 `wpProperty: config.MANAGER_WP_PROPERTY` 전달. 오진 방지 경고 **2종**(impact 패턴): ①`MANAGER_WP_VERIFY` off(verifyWp 미경유 무음 no-op) ②oracleStore 부재(항상 skip). 가시성 하한(conformance+impact+property 동시 시 WP당 ~9단계)은 기존 conformance 600s 경고가 커버하며 `MANAGER_WP_PROPERTY` config 주석에 명시.
- **OutboxRelay 조건 미포함**: property는 읽기전용이라 아웃박스를 쓰지 않음(impact/conformance와 동일).

## 5. author plan 인코딩 (boundary + 명시 속성 단언)

`buildInvariantAuthorPlan`은 독립 develop_code에게 다음을 지시한다:
- story `wp.storyId`·work package `wp.id`의 실행 가능한 property 테스트를 `PROPERTY_DIR/<wpId>.*`(프로젝트 테스트 프레임워크 확장자)에 작성.
- **구현 파일 수정 금지**(N6) — property 테스트 파일만 작성.
- 각 human_approved invariant에 대해, **무작위 fuzzing이 아니라 결정론적 케이스**로:
  - `property` 술어의 **임계 경계 케이스**(threshold ± ε: 경계 직전·경계·경계 직후 최소 3점)를 명시적으로 작성.
  - `domain` 서술이 시사하는 **대표 입력**들에 대해 `property`가 성립함을 단언.
- 각 invariant 블록 렌더: `Invariant {id} — {statement}\n  Domain: {domain}\n  Property: {property}`.
- 4000자 클램프(planner/developer `.max(4000)` 정합).

판정은 author가 만든 testFiles를 Tester가 실 실행한 결과(`success && failed===0 && passed>0`)로만 성립(N1). author가 테스트를 안 쓰거나(빈 selectAuthoredTestFiles→fail) 0-test면(passed=0→vacuous fail) 게이트는 안 열린다.

## 6. 테스트 전략 (TDD)

### 6.1 신규 `streams/verify.property.test.ts` (impact 테스트 미러)
- property off → invariant 미조회·skip(ok).
- 승인 invariant 없음(null) → skip(ok·회귀 0).
- property 충족(author 테스트 통과·passed>0) → ok.
- property 위반(run 결과 fail) → fail(blocking).
- author 테스트 미작성(selectAuthoredTestFiles empty) → fail-closed(reason에 PROPERTY_DIR).
- vacuous(passed=0) → fail.
- workspaceRoot 부재 → fail-closed.

### 6.2 `db/oracle-*.integration.test.ts` (skip-if-no-DB)
- `approvedInvariantsForStory`: human_approved 필터(drafted/rejected 제외)·승인 행 없음→null·0개→null·읽기전용(쿼리 후 행 무변경).

### 6.3 `streams/conformance.test.ts` (기존 파일 확장)
- `selectAuthoredTestFiles(artifacts, PROPERTY_DIR, wpId)` 좌측앵커(wp-7 vs wp-70)·확장자 필터·node_modules 임베딩 거부(impact dir 테스트 패턴 복제).
- `buildInvariantAuthorPlan`: 4000자 클램프·"구현 수정 금지" 문구·propertyStem 경로·invariant 블록 렌더.

### 6.4 `config.test.ts`
- `MANAGER_WP_PROPERTY` flag 블록(기존 flag describe 패턴 복제).

### 6.5 동치 회귀 (A2 루프 리팩터)
- 데이터 주도 루프 교체 후 기존 `verify.test.ts`·`verify.impact.test.ts`(conformance·impact develop_code 경로)가 **무수정 통과**(동작 보존 실증).

### 6.6 수용 기준
- flag off → `verifyWp` 경로 바이트 동일·회귀 0.
- 전체 테스트 통과·build(tsc)·`pnpm audit` 0·jscpd 0 clones.

## 7. 범위 밖 (후속)

- **property-based fuzz**(fast-check/hypothesis·risk-proportional iters `by_risk(risk)`) — P2r 리스크 라우팅이 검증에 배선된 후.
- **metamorphic 관계**(정확 답이 진술 불가할 때의 conformance 기법, §2).
- **invariant draft 생성기**(P3-2 유사 — PM이 Story에서 invariant 초안 생성).
- **mutation θ_risk**(N8 완전판 — correctness 게이트 = adversarial-pass AND mutation_score≥θ_risk).
- 읽기전용 워크스페이스 마운트(author no-modify는 현재 프롬프트 지시뿐).
- WP당 에이전트 호출 수 상한·채널 병렬화(conformance+impact+property 동시 시 ~9단계).
