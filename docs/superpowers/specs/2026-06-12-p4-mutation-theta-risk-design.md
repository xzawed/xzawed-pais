# P4 mutation θ_risk 게이트 (N8 강화) — 설계

- 날짜: 2026-06-12
- 상태: 설계 승인됨
- 선행: P4b-3 vacuous-pass `passed>0` floor·P4 impact(#294)·property(#295)·advisory(#292)
- 사양 출처: `docs/senario/VERIFICATION_ADVERSARIAL_STRATEGY.md` §3·§7·§9, `docs/senario/xzawedPAIS_handoff_spec.md` §1(N8)·§9 (충돌 시 사양 우선)

## 1. 배경·동기

### 1.1 N8의 둘째 이빨
사양의 correctness 게이트는 **두 부분**이다(§9 verbatim: `correctness = all(results.blocking) and mscore >= theta(risk)`):
1. **적대 케이스 실행-통과** — author→run 채널(conformance·impact·property)로 구축 완료.
2. **mutation_score ≥ θ_risk** — **미구축**. 이 슬라이스가 채운다.

N8(§1): "빈 껍데기 스위트로 게이트를 열지 않는다 — '테스트 통과'가 낮은 mutation score로 성립하면 닫힘. N1('실행된 결과')의 강화." 이미 착륙한 `passed>0` vacuous floor(P4b-3)는 N8의 **degenerate 선행**(0-test만 차단). 진짜 N8 = `mutation_score ≥ θ_risk`.

### 1.2 mutation testing 정의 (§3)
**mutant** = 산출물(impl)에 주입한 의도적 결함. **mutation_score = killed/total**(스위트가 mutant를 잡아 실패하는 비율). θ_risk = 위험 등급별 floor(ordinal **HIGH > MEDIUM > LOW**; 수치는 캘리브레이션·연기). 사양은 **도구 비종속**(Stryker/mutmut/LLM 어느 것도 강제·금지 안 함) — killed/total 계약과 N1(실행-근거)만 요구.

### 1.3 구조적 제약 (탐색 발견)
- mutation 도구 0(Stryker/mutmut Tester allowlist에 없음).
- **revert/restore 프리미티브 부재** — develop_code `applyChange`는 create/modify를 백업 없이 덮어씀 → live impl을 mutate-then-restore 불가.
- run_tests는 **live 워크스페이스**만 실행 → 별도 mutated 복사본 타겟 불가.
- K-fold 비용 — mutant마다 스위트 재실행 → lease 가시성 폭증(conformance+impact+property 이미 ~9단계).

이 제약들 때문에 "live impl in-place mutate" 접근은 막혀 있고, **자가단언 하니스** 접근을 택한다(§3 결정).

## 2. 불변식 (반드시 충족)

| ID | 불변식 | 적용 |
|---|---|---|
| N8 | 빈/약한 스위트로 게이트 미개방 | mutation_score < θ면 fail(blocking). passed>0 floor 위 추가 이빨. |
| N1 | 실행된 ground truth(LLM 선언 불가) | 점수는 하니스가 **실 코드 실행**으로 산출(LLM이 "이 mutant는 잡힘" 선언 금지). Tester 실 실행 결과로 판정. |
| — | fail-closed/never-throw | 하니스 throw·미작성·timeout·score<θ → `{ok:false}`. uncertain=fail. |
| — | flag-off 회귀 0 | `MANAGER_WP_MUTATION` off면 `runChannelChecks` 기여 0·verifyWp 바이트 동일. |
| — | 비용 bound | HIGH-risk만(min-tier)·maxMutants 캡·K-fold는 단일 Tester 런 내부. |
| N7 | 오라클/golden 읽기전용 | mutation은 oracle 미소비(영향 없음). |

## 3. 설계 결정

### D1. 실행 메커니즘 = 자가단언 mutation 하니스 (PO 확정)
live impl을 in-place mutate하는 대신, 독립 develop_code가 **자가단언 하니스**를 `.xzawed/mutation/<wpId>.*`에 작성한다. 하니스는 런타임에:
1. WP impl 모듈을 ≤`maxMutants`회 mutate(복사본/in-memory — 실 구현 파일 미수정).
2. 각 mutant에 대해 WP 기존 테스트를 재실행.
3. `killed`(스위트 실패) / `total` 집계.
4. **`killed/total < θ`면 테스트를 fail**(assert/throw)시킨다(θ는 plan에 임베드).

Tester가 이 하니스를 실행 → `judgePrimaryResult('run_tests')`가 판정: **하니스 통과(score≥θ)→ok / 하니스 실패(score<θ 또는 오류)→fail(blocking)**. 자가단언 구조라 별도 score-파싱 judge 불필요 — 기존 judge가 그대로 게이트.

이유: (a) **N1 실행-근거**(하니스가 실 코드를 돌려 점수 산출). (b) **비용 bound** — K-fold가 단일 Tester 런 안에 포함되어 에이전트 호출은 author+run 2회(다른 채널과 동일). (c) revert 프리미티브 불필요(복사본/in-memory mutate). (d) `executeAuthoredTest` 재사용(CPD0). 실 mutation 도구(Stryker)·Developer snapshot/restore는 기각(프로젝트 의존·에이전트 수정·scope 큼).

### D2. risk 게이팅 = HIGH-risk만 + 단일 고정 θ (PO 확정)
- `wp.risk`(LOW/MEDIUM/HIGH·기본 MEDIUM·이미 verifyWp의 wp 인자)를 직접 읽음(P2r 대기 불필요·미배선/미populate).
- **min-tier 게이트** `MANAGER_MUTATION_MIN_RISK`(기본 `HIGH`): `riskRank(wp.risk) ≥ riskRank(minRisk)`면 실행, 아니면 skip(ok). 기본 HIGH라 현재 dormant(spec "HIGH→mutation 필수" 정렬·비용 bound; 테스트/데모 시 env로 MEDIUM 낮춤).
- **단일 θ** `MANAGER_MUTATION_THETA`(기본 0.6·env 오버라이드 캘리브레이션). per-tier θ는 후속(P2r populate + 운영 데이터 후).

### D3. 배치 = runChannelChecks 새 채널 (judge 미접)
`judgePrimaryResult`는 `{success,passed,failed}`만 보므로 mutation score를 호스트 못 함. `runMutationCheck`를 `runChannelChecks` 데이터주도 리스트 `[conformance, impact, property]`에 **append**(develop_code 한정). 단락 hard-AND. `verifyWp`는 `runDerivedChecks`(파생 빌드·테스트 green) 통과 후에만 `runChannelChecks` 진입 → mutation은 **이미 green인 스위트**에만 동작(red 스위트 mutate 안 함).

### D4. oracle 불필요 / 새 migration·table 없음
mutation은 사람 승인 oracle 아티팩트를 읽지 않는다(impl을 mutate + 기존 테스트 재실행). 따라서:
- `buildWorkerConsumerDeps`: `mutationEnabled = config.wpMutation === true`(**`&& oracleStore != null` 절 없음**). handler 부재는 `runMutationCheck`가 fail-closed.
- server.ts oracleStore 생성 OR-조건에 `MANAGER_WP_MUTATION` **미추가**.
- `runAuthoredCheck<T>` **미사용**(oracle baseline 전제라 부적합). `runMutationCheck`는 자체 guard 후 `executeAuthoredTest` 직접 호출.
- 새 migration·영속 테이블 없음(verdict가 신호·blocking 시 완료 미발행→lease 백스톱).

## 4. 아키텍처 — 파일별 (전부 manager-side·shared 무변경·새 migration 없음)

### 4.1 `streams/conformance.ts` — 채널 시밍
- `MUTATION_DIR = '.xzawed/mutation'` + `mutationStem(wpId)`.
- `buildMutationHarnessPlan(wp, opts: { theta: number; maxMutants: number }): string` — 독립 develop_code에게 자가단언 mutation 하니스를 `mutationStem(wp.id)`에 작성하라 지시(§5 상세). "실 구현 파일 수정 금지"·θ·maxMutants 임베드·4000 클램프.
- `selectAuthoredTestFiles`는 그대로 재사용(MUTATION_DIR 전달).

### 4.2 `streams/verify.ts` — 채널 + 헬퍼
- `VerifyDeps`에 추가: `mutationEnabled?: boolean`·`mutationTheta?: number`·`mutationMinRisk?: WpRisk`·`mutationMaxMutants?: number`.
- 순수 헬퍼 `meetsMinRisk(wpRisk, minRisk)` — rank(LOW=0,MEDIUM=1,HIGH=2); `rank(wpRisk) >= rank(minRisk)`.
- `runMutationCheck(wp, deps)`:
  ```
  if (deps.mutationEnabled !== true) return {ok:true}
  if (!meetsMinRisk(wp.risk, deps.mutationMinRisk ?? 'HIGH')) return {ok:true}  // HIGH-gated skip
  if (!deps.userContext?.workspaceRoot) return {ok:false, reason: 'mutation: workspaceRoot 미영속...'}
  if (!deps.handlers['develop_code'] || !deps.handlers['run_tests']) return {ok:false, reason:'mutation: 핸들러 미주입'}
  const plan = buildMutationHarnessPlan(wp, { theta: deps.mutationTheta ?? DEFAULT_THETA, maxMutants: deps.mutationMaxMutants ?? DEFAULT_MAX_MUTANTS })
  return executeAuthoredTest(wp, deps, plan, MUTATION_DIR, 'mut-author', 'mut-run')
  ```
- `runChannelChecks` 리스트에 `runMutationCheck` append → `[runConformanceCheck, runImpactCheck, runPropertyCheck, runMutationCheck]`. never-throw fail-closed(executeAuthoredTest/execConformanceStep 재사용).
- `DEFAULT_THETA = 0.6`·`DEFAULT_MAX_MUTANTS = 10` 상수.

### 4.3 `streams/worker.ts` — 스레딩
- `WorkerDeps`에 `mutationEnabled?`·`mutationTheta?`·`mutationMinRisk?`·`mutationMaxMutants?` 추가.
- `runVerifyGate`의 `verifyWp` deps에 4개 전달(`mutationEnabled: deps.mutationEnabled === true` 외 3개 그대로).

### 4.4 `streams/supervisor.ts` — 배선
- `SupervisorConfig`에 `wpMutation?: boolean`·`mutationTheta?: number`·`mutationMinRisk?: WpRisk`·`mutationMaxMutants?: number`.
- `buildWorkerConsumerDeps`: `mutationEnabled: config.wpMutation === true`(store 절 없음) + theta/minRisk/maxMutants 스레딩.

### 4.5 `config.ts`·`server.ts`
- `config.ts`: `MANAGER_WP_MUTATION`(flag·기본 false)·`MANAGER_MUTATION_THETA`(`z.coerce.number().min(0).max(1).default(0.6)`)·`MANAGER_MUTATION_MIN_RISK`(`z.enum(['LOW','MEDIUM','HIGH']).catch('HIGH').default('HIGH')`)·`MANAGER_MUTATION_MAX_MUTANTS`(`z.coerce.number().int().positive().default(10)`).
- `server.ts`: createSupervisor config에 4개 전달. oracleStore 조건 **미수정**. 오진 경고 2종: ①`MANAGER_WP_MUTATION && !MANAGER_WP_VERIFY`(verifyWp 미경유 no-op) ②**lease-visibility 하한**(mutation K-fold가 가장 비쌈 → `MANAGER_LEASE_VISIBILITY_MS` 상향 강력 권장).

## 5. 하니스 plan 인코딩 (`buildMutationHarnessPlan`)

독립 develop_code에게 지시:
- story `wp.storyId`·WP `wp.id`의 실행 가능한 **자가단언 mutation 하니스**를 `mutationStem(wp.id)`(프로젝트 테스트 프레임워크 확장자)에 작성.
- **실 구현 파일 수정 금지**(복사본/in-memory로 mutate) — 하니스 테스트 파일만 작성.
- 하니스는 하나의 테스트 케이스로서 런타임에:
  1. 이 WP가 구현한 모듈에 최대 `{maxMutants}`개의 작은 의미 변형(mutant)을 적용(연산자 뒤집기·경계 변경·조기 반환 등) — **복사본 또는 메모리 상에서**.
  2. 각 mutant에 대해 이 WP의 기존 테스트를 실행하고, 스위트가 실패하면 killed로 집계.
  3. `mutation_score = killed / total`을 계산.
  4. `mutation_score < {theta}`이면 명확한 메시지와 함께 테스트를 **실패**시킨다(통과 조건 = score ≥ {theta}).
- mutant를 **하나도 생성/실행 못 하거나**(total=0) 점수를 측정 불가하면 테스트를 **실패**시킨다(불확실=fail·N1·vacuous mutation 차단 — 0개 mutant로 score를 trivially 통과시키지 않는다).
- 점수는 반드시 **실제 실행 결과**로 산출(어떤 mutant가 잡히는지 추측·선언 금지·N1).
- `.slice(0, 4000)` 클램프.

판정: Tester가 하니스를 실행 → `judgePrimaryResult('run_tests')`. 하니스 통과(passed>0·failed=0·score≥θ)→ok. 하니스 실패(score<θ)→fail. 하니스 미작성(selectAuthoredTestFiles empty)→fail-closed.

## 6. 테스트 (TDD)

### 6.1 신규 `streams/verify.mutation.test.ts`
- mutationEnabled off → skip(ok)·하니스 미호출.
- wp.risk='MEDIUM', minRisk='HIGH' → skip(ok·min-tier 게이트).
- wp.risk='HIGH', 하니스 통과(okTester) → ok.
- wp.risk='HIGH', 하니스 실패(failTester) → fail(blocking).
- wp.risk='HIGH', author 미작성(empty artifacts) → fail-closed(reason에 MUTATION_DIR).
- minRisk='MEDIUM'면 MEDIUM WP 실행(게이트 하향 동작).
- workspaceRoot 부재 → fail-closed.

### 6.2 `streams/conformance.test.ts`
- `selectAuthoredTestFiles(artifacts, MUTATION_DIR, wpId)` 좌측앵커·확장자·node_modules 거부.
- `buildMutationHarnessPlan`: θ·maxMutants·"수정 금지"·mutationStem 경로·4000 클램프.

### 6.3 `streams/verify.test.ts`(또는 별도) — `meetsMinRisk` 순수 단위
- LOW/MEDIUM/HIGH × minRisk 조합의 rank 비교 진리표.

### 6.4 `config.test.ts`
- `MANAGER_WP_MUTATION`(기본 false·'true'→true)·`MANAGER_MUTATION_THETA`(기본 0.6·파싱)·`MANAGER_MUTATION_MIN_RISK`(기본 HIGH·불량값 catch)·`MANAGER_MUTATION_MAX_MUTANTS`(기본 10).

### 6.5 동치 회귀
- `runChannelChecks`에 채널 추가 후 기존 conformance/impact/property 테스트 무수정 통과(mutationEnabled undefined→skip).

### 6.6 수용 기준
- flag off → verifyWp 바이트 동일·회귀 0. build·audit 0·jscpd 0 clones.

## 7. 범위 밖 (후속)

- **per-tier θ**(P2r risk populate + 캘리브레이션 데이터 후).
- **실 mutation 도구**(Stryker/mutmut) via Tester mode — 신뢰성↑이나 프로젝트 의존·allowlist·Tester 계약 변경.
- 하니스 품질 메타-검증(LLM이 대표성 있는 mutant를 만드는지).
- `mutation_results` 영속 테이블(관측/audit).
- P2r-3 LLM 리스크 생산자(wp.risk 실제 채움) · **P5 릴리스 게이트(M1)**.
