# P4 security 채널 (4d·SAST blocking, source-tagged) — 설계

- 날짜: 2026-06-13
- 상태: 설계 승인됨
- 선행: P4b-1 검증 게이트(#273)·P4b-2 conformance(#274)·P4b-3 vacuous floor(#275)·impact(#294)·property(#295)·mutation(#296)
- 사양 출처: `docs/senario/VERIFICATION_ADVERSARIAL_STRATEGY.md` §1·§5·§9, `docs/senario/xzawedPAIS_handoff_spec.md` §9(검증 3채널·N1) (충돌 시 사양 우선)
- 영향 서비스: **xzawedManager**(검증 채널) + **xzawedSecurity**(source 태그·additive)

## 1. 배경·동기

### 1.1 빈 plan 갭과 시퀀싱 트랩
현재 `verify.ts`의 `planVerificationChecks(tool)`는 `develop_code`에만 파생 체크를 반환하고 `security_audit`·`design_ui`에는 **빈 plan**을 반환하며, `judgePrimaryResult`는 run_tests/build_project 외 도구를 `{ok:true}` pass-through한다. 즉 **보안 검증 채널이 존재하지 않는다**. 검증 3채널(spec §9)의 셋째 렌즈 중 security 부분(§1: "security(특수) — 위협 모델링(STRIDE)+abuse 케이스 → blocking")이 비어 있다.

이것은 **P5 릴리스 게이트의 선결 조건**이다. P5 게이트는 `TC ∧ conformance ∧ security ∧ regression` 하드 AND(§7·M1)인데, security 채널이 없으면 그 항이 skip=ok로 통과돼 **fail-open을 fail-closed로 위장**한다(M1/N1 위반). 따라서 P5 이전에 security 채널이 **먼저 착륙**해야 한다(`docs/development/roadmap.md` §149 시퀀싱 트랩).

### 1.2 SAST는 N1 ground-truth (탐색 발견)
spec Phase 4 산출물은 "실행 ground truth 하니스(샌드박스 TC·**SAST**·타입체크·빌드; N1)"로 SAST를 **명시적으로 N1 하니스**로 규정한다. xzawedSecurity 에이전트는 이미 세 분석기를 `Promise.all`로 실행한다:
- `analyzers/static.ts` — OWASP 정규식 규칙 5개(S001~S005)로 소스 직접 스캔. **결정론·실행 근거**.
- `analyzers/deps.ts` — `npm audit --json` 실행 → SecurityIssue 변환. **결정론·실 도구**.
- `claude/runner.ts` — Anthropic SDK OWASP 추가 분석. **LLM**(ground truth 아님).

출력 계약: `audit_complete.payload.{issues: SecurityIssue[], score, summary, content}`. `security_audit` 핸들러는 이미 server.ts의 워커 5종 handlers 맵에 존재한다(develop_code·design_ui·run_tests·build_project·security_audit).

### 1.3 핵심 설계 갈림길(결정됨)
- **검증 방식**: SAST 직접 실행(에이전트의 결정론 findings를 severity 임계로 판정) ← 채택. STRIDE author→run(conformance/property 패턴)은 오라클 시딩 없으면 휴면이고 security 에이전트가 테스트를 쓰지 못하므로 보류.
- **source 구분**: LLM findings를 게이트에서 제외(N6: 자기검증은 신호일 뿐 권위 아님)하려면 결정론 findings와 구분해야 한다 → **SecurityIssue에 `source` 태그 additive 추가**(에이전트가 분석기별로 태깅) ← 채택. Manager 휴리스틱 필터(rule-id)는 security 내부 구조에 결합(드리프트 위험)이라 보류.

### 1.4 즉시 작동(휴면 아님)
conformance·impact·property는 오라클(GWT/golden/invariants)을 사람이 시드해야 작동하나 현재 시드가 없어 사실상 **휴면**이다. security 채널은 **SAST가 자기완결**(오라클 불필요)이라 flag만 켜면 **즉시 작동**한다 — mutation 채널과 동형(둘 다 oracle 미소비).

## 2. 불변식 (반드시 충족)

| ID | 불변식 | 적용 |
|---|---|---|
| N1 | 실행된 ground truth(LLM 선언 불가) | 게이트는 결정론 SAST(static 규칙·npm audit) findings로만 판정. LLM findings 제외. |
| N6 | 자기검증·투표는 신호일 뿐, 권위 아님 | `source:'llm'` findings는 게이트 차단에 미사용(advisory 라우팅은 후속). |
| — | fail-closed/never-throw | 에이전트 throw·결과 파싱 실패(`source` 부재 포함)·workspaceRoot/handler 부재 → `{ok:false}`. 불확실=실패. |
| — | flag-off 회귀 0 | `MANAGER_WP_SECURITY` off면 `runChannelChecks` 기여 0·verifyWp 바이트 동일. |
| — | 비용 bound | WP당 security_audit 호출 1회(author→run 없음). |
| N3 | advisory가 게이트를 막지 않음 | LLM 보안 findings는 비차단(현재 미소비). 차단은 결정론 SAST만. |

## 3. 설계 결정

### D1. SAST 직접 실행 채널 (author→run 아님)
security 채널은 `runAuthoredCheck<T>`(베이스라인→author develop_code→Tester run)를 쓰지 **않는다**. 베이스라인(오라클)이 없고, ground truth가 author가 쓴 테스트가 아니라 **security_audit 에이전트의 SAST 출력 자체**이기 때문이다. 대신 `runDerivedChecks`(build/test 직접 실행)에 가까운 **직접-에이전트 채널**이다. `execConformanceStep`(buildInput+execute를 try로 감싸 throw→fail verdict)을 재사용(CPD0)한다.

### D2. source 태그로 결정론/LLM 분리
SecurityIssue에 `source: 'static' | 'deps' | 'llm'` 추가. 각 분석기가 자기 findings를 태깅:
- `static.ts` → `'static'`, `deps.ts` → `'deps'`, `claude/runner.ts` → `'llm'`.

Manager는 `source ∈ {static, deps}` ∧ `severity ≥ floor` findings만 차단에 사용. `source`는 Manager 판정 스키마에서 **required** — 부재(미업그레이드 에이전트)는 파싱 실패=**fail-closed**(불확실=실패·N1). 모노레포 동시 배포 전제(security·manager 같은 PR).

### D3. WP 산출 파일만 static 스캔 대상
`security_audit` 입력 `artifacts`에 **develop_code WP가 산출한 파일**(`result.artifacts`)만 전달 → static 규칙이 WP가 손대지 않은 파일의 기존 결함으로 차단하지 않게 한다(§11 결함 국소화 영역 회피·attribution은 4c). `projectPath = userContext.workspaceRoot`(deps audit은 프로젝트 단위 의존성이라 전체). 입력 `severity:'low'`로 에이전트가 전부 보고하게 하고 floor는 Manager 단일출처로 필터.

### D4. severity floor = HIGH 기본·env 조정
`MANAGER_WP_SECURITY_MIN_SEVERITY`(기본 `'high'`·불량값 high 폴백). static 규칙이 정확히 high(S003~S005)/critical(S001~S002)이라 high floor가 자연 경계. medium/low는 비차단(정보성). mutation `meetsMinRisk` 패턴 재사용.

**casing 단일화(모호성 제거)**: SecurityIssue `severity`는 **소문자**(`'low'|'medium'|'high'|'critical'` — xzawedSecurity 계약)다. `SEVERITY_RANK`는 소문자 키(`{low:0, medium:1, high:2, critical:3}`)로 정의하고, env 값은 `.toLowerCase()`로 정규화한 뒤 비교한다. `meetsMinSeverity(sev, floor)` = `SEVERITY_RANK[sev] >= SEVERITY_RANK[floor]`. 정규화 후 키에 없는 값은 floor 폴백(`'high'`).

### D5. oracle 불필요 → 배선 단순
mutation과 동형으로 `securityEnabled = config.wpSecurity === true`(oracleStore 절 없음). server.ts **oracleStore 생성 조건 미수정**·**OutboxRelay 조건 미포함**(security는 실행/읽기만·이벤트 영속 0). migration·oracle 스키마 변경 없음.

### D6. 채널 루프에 append
`runChannelChecks`의 데이터 주도 리스트를 `[runConformanceCheck, runImpactCheck, runPropertyCheck, runMutationCheck, runSecurityCheck]`로 확장(끝에 append·hard-AND·첫 non-ok 단락). security만 `artifacts`가 필요하므로 `verifyWp`가 `result.artifacts`를 추출해 `runChannelChecks(wp, deps, artifacts)`로 스레딩(다른 채널은 미사용).

## 4. 구현 (파일별)

### 4.1 xzawedSecurity (additive)
- `src/types.ts` — `SecurityIssue`에 `source: z.enum(['static','deps','llm'])` 추가. `SecurityToManagerMessage` 응답 issues에 반영.
- `src/analyzers/static.ts` — 생성 issue에 `source:'static'`.
- `src/analyzers/deps.ts` — 생성 issue에 `source:'deps'`.
- `src/claude/runner.ts` — 생성 issue에 `source:'llm'`.
- `score`·`filterBySeverity`·협업·도메인 지식 emit 등 **동작 불변**(필드 추가만).
- 기존 111 테스트 픽스처에 `source` 채움 + 분석기별 태그 단위 테스트.

### 4.2 xzawedManager — `streams/verify.ts`
- `SECURITY_SOURCES = ['static','deps'] as const`·`SEVERITY_RANK = { low:0, medium:1, high:2, critical:3 }`(소문자 키)·`DEFAULT_SECURITY_MIN_SEVERITY='high'`.
- `SecurityResultSchema = z.object({ issues: z.array(z.object({ severity: z.enum(['low','medium','high','critical']), source: z.enum(['static','deps','llm']) })) })` — 판정 전용 minimal·`severity`·`source` 모두 required(부재=fail-closed).
- `VerifyDeps`에 `securityEnabled?: boolean`·`securityMinSeverity?: Severity` 추가.
- `meetsMinSeverity(sev, floor)` 헬퍼(meetsMinRisk 패턴).
- `runSecurityCheck(wp, artifacts, deps): Promise<VerificationVerdict>`(never-throw):
  1. `deps.securityEnabled !== true` → `{ok:true}`.
  2. `!deps.userContext?.workspaceRoot` → fail. `!deps.handlers['security_audit']` → fail.
  3. `execConformanceStep(deps, wp, { artifacts, projectPath: workspaceRoot, severity: 'low' }, 'security_audit', 'security')`.
  4. 결과 `SecurityResultSchema.safeParse` 실패 → fail. `issues.filter(i => SECURITY_SOURCES.includes(i.source) && meetsMinSeverity(i.severity, floor))` 비어있지 않으면 fail(reason에 상위 ≤3건 file/severity/category 요약·REASON_MAX 클램프), 아니면 `{ok:true}`.
- `runChannelChecks(wp, deps, artifacts)` 시그니처에 `artifacts: string[]` 추가·리스트에 `(w,d)=>runSecurityCheck(w,artifacts,d)` append.
- `verifyWp`가 develop_code 경로에서 `result.artifacts` 추출(executeAuthoredTest와 동일: `Array.isArray ? filter(string) : []`) 후 `runChannelChecks(wp, deps, artifacts)` 호출.

### 4.3 배선 — `worker.ts`·`supervisor.ts`·`server.ts`·`config.ts`
- `WorkerDeps`에 `securityEnabled?`·`securityMinSeverity?` 추가 → verifyEnabled 경로 verify deps 합류.
- `SupervisorConfig.wpSecurity?`·`SupervisorConfig.securityMinSeverity?` → `buildWorkerConsumerDeps`가 `securityEnabled = config.wpSecurity === true`(행동 단언)·`securityMinSeverity` 스레딩.
- `config.ts`: `MANAGER_WP_SECURITY`(z.coerce boolean default false)·`MANAGER_WP_SECURITY_MIN_SEVERITY`(enum LOW/MEDIUM/HIGH/CRITICAL·불량값 HIGH 폴백).
- `server.ts`: `wpSecurity`·`securityMinSeverity` 전달 + 오진 경고 2종(`MANAGER_WP_SECURITY` on인데 ①`MANAGER_WP_VERIFY` off → verifyWp 미경유 무음 no-op ②`MANAGER_LEASE_VISIBILITY_MS` 낮음 → WP당 +1 에이전트 호출). oracleStore 생성 조건·OutboxRelay 조건 **미수정**.

## 5. 테스트 (TDD)

### 5.1 verify.ts 단위
- skip: `securityEnabled=false` → `{ok:true}`(호출 0).
- fail-closed: workspaceRoot 부재·`security_audit` 핸들러 부재·에이전트 throw·결과 파싱 실패(`source` 부재)·`issues` 비배열.
- 판정: `source:'llm'` high → **통과**(제외). `source:'static'` high → **차단**. `source:'deps'` critical → 차단. `source:'static'` medium + floor HIGH → 통과. floor를 MEDIUM로 내리면 medium static 차단.
- 채널 루프: `runChannelChecks`가 security를 append하고 앞 채널 fail 시 security 미도달(단락)·앞 통과 시 security 도달. `verifyWp`가 `result.artifacts`를 security에 전달.

### 5.2 xzawedSecurity 단위
- static/deps/claude 분석기가 각각 올바른 `source` 태그. 스키마 round-trip.

### 5.3 SonarCloud QG 방어 (#296 교훈)
배선 코드(server.ts)는 신규 커버 80% 미달을 유발하므로 `buildWorkerConsumerDeps`(securityEnabled 행동 단언)·`runVerifyGate` 경로를 **단위 테스트로 커버**. jscpd: `execConformanceStep` 재사용으로 CPD0 유지.

### 5.4 회귀 0
flag off면 기존 verify·worker 테스트 바이트 동일(security 미배선).

## 6. 정직한 한계 (후속)

- **deps 분석기 fail-open**: security 에이전트 `analyzers/deps.ts`가 `npm audit` 실패 시 `.catch(()=>[])`로 빈 findings 반환 → 그 sub-채널 무음 통과(비-node 프로젝트 포함). 분석기 실패를 surface(예: `analyzerErrors` 필드)하게 하는 건 후속 — 현재 게이트는 **반환된** findings로 판정.
- **static 규칙 5개는 좁음**(S001~S005). 진짜 STRIDE 위협 모델링·abuse 케이스 author→run(Shape 2)·property-fuzz는 후속. 이 슬라이스는 SAST 베이스라인.
- **LLM 보안 findings 미소비**: `source:'llm'` findings는 게이트 미사용. advisory(N3) 큐 라우팅은 후속.
- **security_audit/design_ui WP 자체 auto-pass** 갭(빈 plan→pass-through)은 별개 슬라이스(이 채널은 develop_code 산출 코드 검증).
- **designer(design_ui) 검증**은 범위 밖.
- **per-tier 강도**(HIGH risk만 위협 모델링 필수·§1)는 wp.risk populate(P2r) 후 — 현재 floor는 전 WP 균일.

## 7. 비-목표 (YAGNI)
- 새 migration·테이블·oracle 필드.
- STRIDE 시나리오 author→run·fuzz.
- regression 채널(이미 impact #294).
- security_audit WP 자체 검증·designer 검증.
- LLM findings advisory 라우팅.
