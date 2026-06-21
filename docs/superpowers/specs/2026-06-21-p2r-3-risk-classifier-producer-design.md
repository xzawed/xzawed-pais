# P2r-3 — Wiki Agent 리스크 분류 **LLM 생산자** 설계

**날짜**: 2026-06-21
**상태**: 설계 승인됨(브레인스토밍 → 본 스펙)
**원천 스펙**: `docs/superpowers/specs/2026-06-11-wiki-agent-risk-classifier-design.md`(슬라이스 분해)·`docs/senario/WIKI_AGENT_RISK_CLASSIFICATION.md`(§20.2)·handoff §5(라우팅)·§19(캘리브레이션)
**선행 슬라이스**: P2r-1 결정론 코어(#286·shared `risk/`)·P2r-2 영속(#288 후속·migration 012·`RiskClassificationRepo`)

## 배경

P2r 리스크 분류 체인은 **코어와 영속만 존재하고 생산자가 없다**. post-#312 재감사가 D2(LLM 분류 생산자 부재)를 **루트 블로커**로 지목했다 — `scoreClassification`(shared)은 테스트만 호출하고, `RiskClassificationRepo`는 server.ts에서 인스턴스화되지 않으며, `risk.approved` 스트림 소비자도 0이다. 그 결과 D1(영속 실가동)·D4(wp.risk populate→mutation θ 게이트)·D5(모델 라우팅)·C5(승인 UI)가 전부 이 하나에 막혀 있다.

P2r-3은 그 체인의 **첫 살아있는 생산자**다: `decompose_request` 처리 시 프로젝트 intent를 리스크 차원으로 조사하고 claim을 추출해 순수 코어(`scoreClassification`)로 `RiskClassification`을 조립하고 **pending으로 영속**한다.

## 범위 결정 (브레인스토밍 확정)

- **생산자만(pending)**: 분류를 생성·pending 영속까지. **사람 승인·wp.risk write-back·라우팅 소비는 P2r-4 후속**. N6 엄격(승인된 분류만 라우팅 확정) — 미승인 분류는 어떤 라우팅/게이트도 바꾸지 않는다.
- **서킷 보호는 risk 스테이지만**: circuit-aware `runStage`를 도입하되 P2r-3 호출만 주입. 기존 decompose 스테이지 전체 보호(G1)는 별도 슬라이스.
- **LLM 구조 = 단일 조사+추출 스테이지(접근법 A)**: 순수 코어가 채점·라우팅·게이트를 결정론으로 처리하므로 LLM은 claim 추출 1회로 충분. "차원별 병렬 조사"는 후속 fidelity 업그레이드.

## 아키텍처 (단위·경계)

```
decompose_request(intent, userContext)
  └─ handleDecomposeRequest  (MANAGER_DECOMPOSE_ENABLED 게이트)
       ├─ produceDecomposition          (기존·불변)
       └─ produceRiskClassification     ★신규·best-effort·never-throw
            guard: riskRepo 있음 AND userContext.projectId 있음 (없으면 skip+log)
            1) runStage(investigate)     ← circuit-aware (budget/provider)
            2) verifyCitations (순수)     ← "인용 해소 검증"
            3) scoreClassification        ← shared 결정론 코어
            4) riskRepo.upsert(pending)
```

### 신규/수정 파일

| 파일 | 종류 | 책임 |
|---|---|---|
| `decompose/stages/risk-investigate.ts` | 신규 | 조사 `StageSpec`(system/user 프롬프트 + `RiskInvestigationSchema`) + **`verifyCitations` 순수 함수** |
| `decompose/risk-producer.ts` | 신규 | `produceRiskClassification(intent, workflowId, deps, userContext)` best-effort 오케스트레이션 + `RiskClassifyDeps` |
| `decompose/stages/run-stage.ts` | 수정(additive) | `StageDeps`에 optional `budget?`/`provider?` 서킷 훅. 주입 시에만 작동 — 미주입이면 바이트 동일(기존 6개 decompose 스테이지 회귀 0) |
| `decompose/trigger.ts` | 수정(additive) | `handleDecomposeRequest`에 optional `riskClassify?: RiskClassifyDeps` 파라미터 → `produceDecomposition` 후 best-effort 호출 |
| `sessions.route.ts` · `server.ts` | 수정(배선) | `MANAGER_RISK_CLASSIFY`+pool 시 `RiskClassificationRepo`+서킷 생성·주입 |
| `config.ts` | 수정 | `MANAGER_RISK_CLASSIFY` flag |

각 단위의 계약:
- **`verifyCitations(claims) → ClaimInput[]`**: LLM/IO 0. 입력 raw claim → 검증된 `ClaimInput[]`. 무인용 폐기·support 클램프·dedup. 단독 테스트 가능.
- **`produceRiskClassification`**: 어떤 실패도 삼키는 best-effort 경계(LLM throw·서킷 throw·파싱 실패·repo throw → skip+log, 절대 decompose 경로 비차단). 반환 `{ classified: boolean, risk?: WpRisk }`(관측·테스트용).
- **circuit-aware `runStage`**: 서킷 미주입이면 P2r-1~P2-3 동작 불변. 주입 시 호출 전 `provider.before()`·`budget.check(wf)`, 성공 시 `provider.onSuccess()`·`budget.record(wf, model, usage)`, provider 실패 분류 시 `onFailure()`.

## 데이터 흐름 — "인용 해소 검증"(결정론)

LLM은 웹 도구가 없으므로 claim의 `support`(독립 소스 수)를 부풀릴 수 있다. 결정론 후처리로 봉합한다:

1. **무인용 claim 폐기** — `citations.length === 0`이면 근거 없음(신호 0)으로 제거.
2. **support 클램프** — `support = clamp(0, min(support, citations.length))`. 제시한 인용 수보다 많은 독립 지지를 주장할 수 없다(confidence 인플레 차단). 음수·비정수 방어.
3. **citation dedup·trim** — 공백 정규화 후 중복 제거(부풀린 support 차단).
4. **차원별 cap** — 차원당 claim ≤ `MAX_CLAIMS_PER_DIMENSION`(8·payload 방어).
5. **complianceFrameworks** — trim·dedup·cap(8). compliance 차원 claim과 무관하게 LLM이 감지한 프레임워크 그대로 수용(MVP — 근거 교차검증은 후속).

검증된 `ClaimInput[]`을 `scoreClassification({ projectId, claims, complianceFrameworks })`에 전달 → `confidenceFromSupport`가 클램프된 support로 confidence 산정 → 코어가 차원 집계·`combineRisk`·`routeModels`·`evaluateHumanGate`로 `RiskClassification` 조립(사람 미승인 `audit.version=1`).

### 조사 스테이지 출력 스키마

```ts
RiskInvestigationSchema = z.object({
  claims: z.array(z.object({
    text: z.string(),
    dimension: z.enum(['domain','complexity','external_deps','compliance']),
    support: z.number(),               // 검증에서 클램프
    citations: z.array(z.string()).default([]),
  })).default([]),
  complianceFrameworks: z.array(z.string()).default([]),
})
```

프롬프트는 모델에게: 프로젝트 intent를 4차원(domain/complexity/external_deps/compliance)으로 평가하고, 각 위험 신호를 **반드시 intent 텍스트·알려진 표준(예: HIPAA)에 대한 인용과 함께** claim으로 제시하라고 지시. 인용 없는 추정은 제출하지 말 것(검증에서 폐기됨을 명시).

## 서킷 보호 (risk 스테이지만 · best-effort 의미 보존)

- server.ts가 기존 `MANAGER_BUDGET_PER_WORKFLOW_USD`/`MANAGER_BUDGET_DAILY_USD`/`MANAGER_PROVIDER_CIRCUIT` config로 `BudgetCircuitBreaker`/`ProviderCircuitBreaker`를 만들어(설정 시) risk 생산자 deps에만 주입. 기존 decompose 스테이지는 미주입 → 현행 G1 상태 유지(이 슬라이스 범위 밖).
- **best-effort 보존**: 서킷이 throw(예산 초과 `BudgetExceededError`·`ProviderCircuitOpenError`)하면 `produceRiskClassification`이 흡수해 **분류만 skip**(decompose 비차단). 서킷의 목적(낭비 호출·비용 폭주 차단)은 skip으로 충족.
- ⚠️ budget breaker는 인메모리·workflowId 키. 러너의 breaker 인스턴스와 **공유하지 않는다**(별도 인스턴스) — 러너+분해 누적 단일 회계는 G1-full 후속(현재도 분해는 러너 breaker 밖). 이 슬라이스는 risk 호출 자체의 보호만 보장.

## flag · 영속 · 전제

- **`MANAGER_RISK_CLASSIFY`** (기본 false·`v === 'true'`). 실질 전제: `MANAGER_DECOMPOSE_ENABLED`(handleDecomposeRequest 도달) + `DATABASE_URL`(repo). off → 바이트 회귀 0.
- **새 migration 없음** — `012 risk_classifications` 이미 존재. `RiskClassificationRepo.upsert`는 pending 행만 적재(이벤트 0 — `approve`만 `risk.approved` 발행하므로 **OutboxRelay 기동 조건 미변경**).
- projectId 부재(레거시·userContext 없음) → skip(graceful·`RiskClassification.projectId`는 min(1) 필수라 형성 불가).

## 검증 (TDD)

- **`verifyCitations`(순수)**: 무인용 폐기·support 클램프(min(support, citations.length))·음수→0·dedup·차원 cap·결정론(입력 순서 무관 동일 출력).
- **investigate StageSpec**: 정상 파싱 → claims / malformed JSON → fallback(빈) / 스키마 위반 → fallback.
- **`produceRiskClassification`**: repo 부재 skip·projectId 부재 skip(둘 다 never-throw)·happy path가 `scoreClassification` 결과로 `upsert` 1회 호출·LLM throw skip·서킷 throw skip·반환 관측치 단언.
- **circuit-aware `runStage`**: 서킷 주입 시 before/onSuccess 호출·budget check/record 호출·circuit-open(before throw) → 호출자 흡수·미주입 시 기존 경로 바이트 동일.
- **DB 통합(`test/risk-classification-producer.integration.test.ts`·skip-if-no-DB)**: produce → `upsert` → `getByWorkflow`가 pending 분류 반환. cleanup prefix 스코프(`wf-rcp-`).
- shared `risk/` 무수정(코어 이미 테스트됨·#286).

## 비범위 (후속 — 명시)

- **사람 승인 라우트/UI**(C5·P2r-4) — `RiskClassificationRepo.approve`는 존재하나 호출 라우트 없음.
- **`risk.approved` 소비 → wp.risk write-back**(D4) — graph_dag에 risk 기록(`updateWpRisk` 또는 재upsert)으로 **mutation θ 게이트 발화**. 본 슬라이스가 그 입력원(승인 가능한 분류)을 처음 만든다.
- **P7 per-WP 재채점** — 프로젝트 단일 risk를 WP별로 세분.
- **모델 라우팅 소비**(D5) — `modelRouting`은 영속되나 에이전트 디스패치가 단일 `CLAUDE_MODEL` 사용.
- **차원별 병렬 조사·웹 근거 인용**(fidelity) · **G1-full**(decompose 전체 서킷).

## 수용 기준

1. `MANAGER_RISK_CLASSIFY` off → 기존 decompose 흐름 바이트 동일(회귀 0·서킷 미주입 runStage 포함).
2. on + projectId 있는 decompose_request → `risk_classifications`에 pending 분류 1행(intent 기반 risk·dimensionScores·modelRouting·humanGate).
3. 무인용 claim·과대 support는 영속 전 결정론 검증으로 폐기/클램프(인용 인플레 차단).
4. LLM·서킷·repo 실패가 decompose 응답을 깨지 않는다(best-effort never-throw).
5. 미승인이라 wp.risk·라우팅·게이트 **무변경**(N6 — 라우팅 확정은 승인 후 P2r-4).
