# P4 advisory 채널 (N3) 설계 — optimization 렌즈 비차단 큐

> 원천: `docs/senario/xzawedPAIS_handoff_spec.md` §9(검증 3렌즈) + `docs/senario/VERIFICATION_ADVERSARIAL_STRATEGY.md` §7(채널 연동).
> 충돌 시 사양 우선.

## 목적

검증 3채널(spec §9) 중 **advisory 채널**의 첫 슬라이스를 도입한다. optimization 렌즈("더 나은 점")가 산출하는 비용·효과 제안을 **correctness(차단) 게이트와 분리된 비차단 큐**로 출력한다. 핵심 불변식은 **N3 — advisory는 절대 게이트를 막지 않는다**("세 발견을 한 스트림에 섞지 말고 correctness 게이트 / advisory 큐 / impact 회귀셋 3채널로 분리", spec §9).

이 슬라이스 위에 후속이 쌓인다: impact 채널의 "결합도 냄새 → advisory" 라우팅(N8 조건부), 풍부한 적대 생성(property/fuzz/metamorphic), advisory 조회 API·UI, 그리고 P5 릴리스 게이트(M1)의 3채널 하드-AND.

## 범위

**포함**: advisory 채널 인프라(이벤트소싱 발행 + 조회용 투영 테이블 + N3 분리 보장) + **최소 optimization-lens 생산자**(직접 Claude 호출 1회로 순위 매긴 제안 산출).

**제외(후속·의존성 명시)**:
- impact 채널의 결합도-냄새 → advisory 라우팅 (impact 채널 선결)
- 깊은 적대 생성(property/fuzz/metamorphic·다각도 반증 수렴)
- advisory 조회 API + Orchestrator UI(채택 → 개선 Task 흐름)
- budget/provider 서킷이 이 LLM 호출을 미보호 — 기존 decompose 파이프라인과 동일 갭이라 일괄 후속
- mutation score θ_risk 게이트(N8)

## 배경 — 현재 코드 상태

- `xzawedManager/packages/server/src/streams/verify.ts` — `verifyWp`는 correctness(`judgePrimaryResult`)+conformance(P4b-2)만. 판정은 이진 `VerificationVerdict = {ok:true} | {ok:false; reason}`. advisory 개념 없음.
- `streams/worker.ts` — `handleWpDispatchSignal`이 `verifyEnabled`면 `verifyWp` 호출, `verdict.ok`이면 `publishCompletion`, 실패면 완료 미발행 → lease 백스톱.
- `db/decision.types.ts` — `severity:'blocking'|'advisory'` 필드가 있으나 `buildDefectBrief`에서 `'blocking'` 하드코딩(advisory 경로 미사용).
- 영속 패턴: `oracle.repo.ts`·`decision.repo.ts`·`risk-classification.repo.ts`가 **단일 tx로 가변/append 프로젝션 + manager_events + manager_outbox** 적재(M5/M7). `createOutboxPublish`·`OutboxRelay`가 at-least-once 발행.

## 아키텍처 — 접근 A(워커의 분리된 best-effort 단계)

```
worker.handleWpDispatchSignal (develop_code WP, verifyEnabled)
  → verifyWp(...)                       ── 차단 게이트 (advisory 무지) ── verdict
       │ verdict.ok=false → 완료 미발행 → lease 백스톱 (P4b 경로 불변)
       │ verdict.ok=true
       ↓
  → produceAdvisory(wp, result, deps)   ── best-effort · never-throw · 결과 discard
       → optimization-lens LLM 1회 (callClaudeText seam)
       → AdvisoryRepo.recordFindings    ── 단일 tx
            ├ manager_events (wp.advisory.found 진실원천)
            ├ manager_outbox → OutboxRelay → manager:events:{wf}
            └ advisory_findings (조회용 투영, 1 finding = 1 row)
  → publishCompletion(...)              ── verdict.ok에만 의존, advisory 성패 무관
```

**N3가 구조적으로 성립하는 이유**: `verifyWp`(차단 게이트)는 advisory를 import/호출하지 않는다. advisory 생산은 게이트가 `verdict.ok`를 낸 *뒤*에만 실행되는 별도 함수이고, 그 성패는 완료/verdict 경로에 미유입된다. 게이트가 advisory를 *볼 수 없으니 막을 수도 없다*. (접근 B는 verifyWp 내부에 두어 규율 의존, 접근 C는 독립 소비자로 과함 — 첫 슬라이스엔 A.)

**통과 산출물에만 생산하는 이유**: verdict.ok=false면 WP는 reclaim·재실행되어 산출물이 바뀐다. 실패 산출물에 advisory를 생성하는 것은 낭비이고, advisory가 게이트의 *하류*에만 위치함을 강화한다.

## 컴포넌트 설계

### 1. 스키마 — `db/advisory.types.ts` (Manager-side)

`oracle.types.ts`·`decision.types.ts` 패턴. zod + 상수 단일출처.

```ts
AdvisoryFindingSchema = z.object({
  rank: z.number().int().min(1),          // 순위(1=최우선), §9 "제안 목록(순위)"
  title: z.string().min(1),               // 제안 한 줄
  rationale: z.string().min(1),           // 비용·효과 근거
  severity: z.literal('advisory'),        // const — 차단 아님(N3 타입 수준 표식)
  sourceLens: z.literal('optimization'),  // §9 렌즈
})
ADVISORY_FOUND_EVENT = 'wp.advisory.found'
ADVISORY_ACTOR = 'advisory-lens'
MAX_FINDINGS = 8                          // payload 폭주 방어(절단)
```

LLM 출력 파싱 전용 스키마(`title`/`rationale`만 LLM이 채우고 rank는 배열 인덱스, severity/sourceLens는 const 합성) — `judgePrimaryResult`의 "기본값 비의존" 철학과 정합하되, advisory는 비차단이라 파싱 실패는 fail-soft(빈 목록).

### 2. migration 013 — `013_advisory_findings.sql`

```sql
CREATE TABLE advisory_findings (
  id           BIGSERIAL PRIMARY KEY,
  workflow_id  TEXT    NOT NULL,
  wp_id        TEXT    NOT NULL,
  attempt      INTEGER NOT NULL,
  rank         INTEGER NOT NULL,
  title        TEXT    NOT NULL,
  rationale    TEXT    NOT NULL,
  severity     TEXT    NOT NULL DEFAULT 'advisory',
  source_lens  TEXT    NOT NULL DEFAULT 'optimization',
  event_id     UUID,                       -- manager_events FK 없음(전방호환, 다른 프로젝션과 동일)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_advisory_findings_workflow ON advisory_findings(workflow_id);
CREATE UNIQUE INDEX uq_advisory_findings_dedup
  ON advisory_findings(workflow_id, wp_id, attempt, rank);  -- 재실행 멱등
```

additive·빈 표 회귀 0. migration 번호 013(012=risk_classifications 다음).

### 3. 영속 — `db/advisory.repo.ts` `AdvisoryRepo`

`recordFindings(workflowId, wpId, attempt, findings[], now?)` — **단일 tx**:
1. `manager_events` INSERT (`wp.advisory.found` 진실원천·correlation=wf·causation=null·actor=ADVISORY_ACTOR·멱등키 `{wf}:wp.advisory.found:{wpId}:{attempt}`)
2. `manager_outbox` INSERT (event_id FK·stream `manager:events:{wf}`·M5)
3. `advisory_findings` INSERT × N (`ON CONFLICT (workflow_id,wp_id,attempt,rank) DO NOTHING` 멱등·M6)
4. COMMIT (safeRollback — `OracleRepo.approve`/`DispatchStore.recordDispatch` 패턴)

`findingsByWorkflow(workflowId)` — 조회용(후속 API/UI·테스트 검증). 빈 findings면 no-op(이벤트 미발행).

### 4. 최소 생산자 — `streams/advisory.ts` `produceAdvisory`

```
produceAdvisory(wp, result, deps): Promise<void>   // never-throw
  - deps.advisoryEnabled && deps.advisoryStore 아니면 return
  - 입력 빌드: WP 계약(intent/acceptanceCriteria) + 완료 산출물 요약(result.artifacts 목록)
  - callClaudeText(deps.claude, deps.model, optimizationPrompt) 1회  // decompose run-stage seam 재사용
  - JSON 파싱 → AdvisoryFindingSchema[] (실패·비배열 → []·fail-soft)
  - MAX_FINDINGS 절단 → rank = 인덱스+1
  - 비어있지 않으면 advisoryStore.recordFindings(...)
  - 전체를 try/catch로 감싸 어떤 throw도 삼킴(best-effort)
```

프롬프트: "다음 산출물에 대해 더 효율적/나은 방식을 비용·효과와 함께 순위 매긴 JSON 배열로 제안하라. 구현을 수정하지 말고 제안만. `[{title, rationale}]` 형식." optimization은 비차단·정보성이라 LLM 판정 허용(N1/N6는 차단 게이트만 구속, spec §9 "optimization은 advisory").

깊은 산출물 *내용* 리뷰(파일 읽기)·다각도 적대 생성은 후속 — 이 슬라이스는 계약+산출물 요약 수준 제안.

### 5. 워커 통합 — `streams/worker.ts`

- `WorkerDeps`에 `advisoryStore?`·`advisoryEnabled?`·`claude?`·`model?` 추가(전부 optional·기본 미동작).
- `verifyEnabled` 경로에서 `verifyWp`가 `verdict.ok`를 낸 직후 `await produceAdvisory(wp, result, deps)` 호출(never-throw라 await해도 안전 — 완료를 잠깐 지연만 하고 차단하지 않음). verdict가 이미 확정된 뒤라 advisory 성패는 완료 결정과 무관(완료 발행 순서와 독립).
- off(`advisoryEnabled` 미주입)면 호출 경로 미진입 → P4b와 바이트 동일·회귀 0.

### 6. 배선 — `streams/supervisor.ts` · `server.ts`

- `SupervisorConfig.wpAdvisory?` 추가. `buildWorkerConsumerDeps(deps, config)`가 `advisoryEnabled = config.wpAdvisory && deps.advisoryStore != null`(**행동 단언** — 스레딩 누락이 무음 no-op이 되지 않도록, P4b-1 `buildWorkerConsumerDeps` 패턴)로 조립.
- `server.ts` — `pool && MANAGER_WP_ADVISORY`이면 `AdvisoryRepo` 생성·주입 + OutboxRelay 기동 조건에 `MANAGER_WP_ADVISORY` 추가(advisory.found 아웃박스→Redis 발행 필요) + `claude`/`model`을 워커 deps에 합류 + 오진 방지 경고(advisory on인데 `MANAGER_WP_VERIFY` off → verifyWp 미경유 무음 no-op).
- `config.ts` — `MANAGER_WP_ADVISORY`(기본 false·가역). 전제 `MANAGER_TASK_WORKER`+`MANAGER_WP_VERIFY`(develop_code 검증 경로 위에 얹힘).

## N3 강제 (load-bearing) + 수용 테스트

불변식: **advisory는 게이트를 막지 않는다.**

1. `verify.ts`에 advisory 참조 0 — 게이트가 advisory를 import/호출하지 않음(구조적 분리·grep 단언 가능).
2. `produceAdvisory` never-throw — 실패·타임아웃·LLM 오류가 완료 결정에 영향 0.
3. advisory는 게이트의 하류(verdict.ok 후)에만 실행.

수용 테스트(ROADMAP P4 "advisory가 게이트를 막지 않음(N3)"):
- **N3-a**: advisory 생산자가 findings를 반환해도 동일 WP의 `verifyWp` verdict 불변(advisory가 verdict 경로에 미유입).
- **N3-b**: advisory 생산자가 throw/타임아웃해도 WP 정상 완료(`publishCompletion` 호출됨).
- **N3-c**: findings는 advisory sink(events+outbox+advisory_findings)에만, 완료/verdict 페이로드엔 미유입.

## 테스트 전략

- **순수 단위**(`advisory.test.ts`): LLM 출력 파싱(정상·비JSON·비배열·부분 필드 → fail-soft `[]`)·MAX_FINDINGS 절단·rank 부여·빈 findings no-op·never-throw(claude throw 삼킴).
- **워커 통합**(worker 테스트 확장): N3-a/b/c 위 3종(mock claude·mock advisoryStore).
- **DB 통합**(`test/advisory.integration.test.ts`, skip-if-no-DB·prefix 스코프 `wf-adv-`): `recordFindings` 단일 tx(events+outbox+findings 원자)·멱등 `(wf,wpId,attempt,rank)` 재삽입 no-op·`findingsByWorkflow` 조회. cleanup prefix 스코프(비스코프 DELETE 금지).
- **배선 단언**: `buildWorkerConsumerDeps`가 `wpAdvisory && advisoryStore`일 때만 `advisoryEnabled=true`(행동 단언).

## 불변식 self-check (spec §1)

- N3 ✅ (이 슬라이스의 본체)
- M5/M7 ✅ (recordFindings 단일 tx·correlation/causation·아웃박스)
- M6 ✅ (멱등키·ON CONFLICT DO NOTHING)
- M8 ✅ (advisory 실패는 무음 유실이 아니라 best-effort 설계상 비차단·게이트 신호는 verdict가 담당)
- N1/N6 ✅ (차단 게이트 불변 — advisory는 LLM 판정이나 게이트를 열지 않음)
- 회귀 0 ✅ (flag off면 바이트 동일)

## 잠재 리스크 / 후속

- advisory LLM 호출이 budget/provider 서킷 미보호(decompose와 동일 기존 갭) → 횡단 하드닝에서 일괄 배선.
- 산출물 요약 수준 제안의 얕음 → 깊은 내용 리뷰·적대 생성은 impact/property 채널과 함께 후속.
- 조회 API·UI 부재 → 채택→개선 Task 흐름은 P6 UI 슬라이스.
