# P3-2 Oracle 초안 생성 (P7) — 사람 작성 부담 흡수 설계

> Phase 3 둘째 슬라이스. [[P3-1]](`2026-06-09-p3-1-oracle-dor-gate-design.md`)이 연 디스패치 게이트의 **사람 병목**(오라클 백지 작성)을 흡수한다. senario `ORACLE_SCHEMA.md` §10(작성 흐름: PM이 초안→사람 승인) 구체화.
> 목표: 분해가 산출한 각 Story에 대해 PM(LLM)이 Given-When-Then 시나리오 **초안**을 생성해 `pending` 오라클로 영속한다. 사람은 백지 작성이 아니라 **초안을 검토·승인**(PATCH approve 한 번)만 하면 DoR이 충족돼 dispatch가 열린다.
>
> **이 문서는 Codex 적대 검증(2026-06-09) 11 블로커 + 2 권고를 반영한 개정본이다.** 반영 내역은 §8.

## 1. 배경 — P3-1이 남긴 사람 병목

P3-1로 디스패치 게이트는 열렸으나, DoR 충족(§8: 각 acceptance_criterion을 덮는 `human_approved` 시나리오 ≥1)을 위해 **사람이 오라클 시나리오를 처음부터 작성**해야 한다(P3-1 리뷰 "human_approved 시드 필요"). P3-2는 이 작성을 LLM 초안으로 대체하고, 승인 한 번으로 초안을 `human_approved`로 전이해 루프를 닫는다.

`ORACLE_SCHEMA.md §10`: *PM(Opus)이 Story에서 시나리오·불변식 초안 → 사람이 검토·수정·승인 → approved oracle vN 고정.* P3-2 = 이 흐름의 초안 생성 + 승인 전이.

## 2. 범위 & 결정 (브레인스토밍 2026-06-09)

**포함**: ①분해 파이프라인 P7 draft 스테이지(LLM) ②`decomposition.emitted`에 `oracleDrafts` 합류 ③consumer가 `OracleRepo.upsertDraft`(pending·멱등) ④`OracleRepo.approve`가 drafted→human_approved 일괄 전이 ⑤`MANAGER_ORACLE_DRAFT` flag ⑥DB-level 통합 테스트(루프 실증).

**제외(후속)**: 시나리오별 개별 승인/거부 UI · invariant/golden 초안 · LLM step-definition 컴파일(N1 실행 바인딩) · 오라클 편집 UI · 재분해 트리거(아래 §6 attemptId 한계).

### 핵심 결정
1. **분해 파이프라인 스테이지**: P7 초안 생성을 decompose 파이프라인의 LLM 스테이지로 추가(producer=LLM·DB없음 / consumer=DB·LLM없음 분리 유지). producer가 `decomposition.emitted` payload에 `oracleDrafts`를 additive로 실어 보내고, Supervisor consumer가 TaskGraph 영속 후 `OracleRepo.upsertDraft`.
2. **approve가 일괄 전이**: `PATCH /oracles/:id/approve`가 oracle status=approved와 함께 그 oracle의 `drafted` 시나리오를 **같은 tx에서 `human_approved`로 일괄 전이**(M2 사람 권위). 일부 거부는 approve 전 편집(후속). **무조건·additive** — drafted 없으면 no-op(P3-1 회귀 0).
3. **커버리지 보장(OK 경로)**: draft 스테이지는 **정상 분해(ok) 경로**에서 모든 AC를 ≥1 시나리오로 덮음(미커버 시 stub 합성). 기술 fallback(단일 WP) 경로는 `oracleDrafts=[]`(degraded — 그 WP는 수동 오라클 대기). §6.

## 3. 컴포넌트 & 데이터 흐름

```
decompose 파이프라인 (producer·LLM):
  epics → slice(stories) → deliverables → roles → [P7 draftOracles] → emit
  decomposition.emitted { workPackages, oracleDrafts }   ← oracleDrafts additive (ok 경로만 채움)

Supervisor consumer (DB):
  handleDecompositionEmitted → TaskGraph upsert
                            → 각 draft: OracleRepo.upsertDraft(oracleId='oracle-{wf}-{storyId}', status=pending·멱등)

[사람] PATCH /oracles/:id/approve   (status=pending인 것만)
  같은 tx: oracles.status=approved + scenarios drafted→human_approved + oracle.approved 이벤트
  → OutboxRelay → oracleConsumer(DOR on) → handleDispatch → coveredCriteria 충족 → ready WP dispatch
```

### 3.1 Draft 스테이지 (`decompose/stages/draft-oracles.ts`)

```ts
export interface OracleDraft {       // ← oracleId 없음(consumer가 workflowId로 파생, blocker#3)
  storyId: string
  scenarios: OracleScenario[]        // status:'drafted', given/when/then 포함
  coverage: Record<string, string[]> // acceptance_criterion → [scenarioId]
}
export async function draftOracles(stories: Story[], deps: StageDeps): Promise<OracleDraft[]>
```

- story별 `runStage`(callClaudeText→JSON→safeParse→fallback) 1회 — LLM이 그 story의 `acceptanceCriteria`를 덮는 Given-When-Then 시나리오 초안 + coverage 생성.
- **커버리지 보장**: LLM 미커버 AC마다 **stub 시나리오**(`{id, title:AC, given:[], when:'', then:[AC], status:'drafted'}`) 합성. `runStage` fallback(LLM 실패) = 빈 → story의 AC별 stub 1개.
- **payload 상한(blocker#7)**: story당 LLM 시나리오 ≤ `MAX_SCENARIOS_PER_STORY`(8)로 절단(stub은 AC 수로 자연 유계). 과대 분해 시 메시지 10MiB 한계 방어.
- 결정론: scenario id = `{storyId}-sc{n}`(순번, oracle JSONB 내부 스코프라 워크플로 충돌 무관). **oracleId는 producer가 부여하지 않음** — consumer가 `oracle-{workflowId}-{storyId}`로 파생.

### 3.2 스키마 (additive)

- **`OracleScenarioSchema` 확장**(`db/oracle.types.ts`): `given`·`then` `z.array(z.string()).default([])`·`when` `z.string().default('')` 추가. **satisfied-set은 status+coverage만 소비** — given/when/then은 사람 검토용. P3-1 회귀 0(전부 기본값).
- **`OracleDraftSchema`**: `{ storyId, scenarios: OracleScenarioSchema[], coverage }` (oracleId 없음).
- **`DecompositionEmittedSchema` payload**: `{ workPackages, oracleDrafts: z.array(OracleDraftSchema).default([]) }` — additive. **z.infer 출력 타입에 `oracleDrafts`가 항상 존재**하므로 **기존 타입드 픽스처(`msg()` 등)에 `oracleDrafts: []`를 채워 컴파일 유지**(blocker#9).

### 3.3 파이프라인·발행

- **`pipeline.ts` `runDecomposition(intent, deps, repairMax, draftEnabled=false)`**: `assignRoles` 후 `draftEnabled`면 `draftOracles(stories, deps)` 호출 → `DecomposeResult`(ok)에 `oracleDrafts` 추가(off면 `[]`). draft 실패는 runStage가 흡수(빈→stub)이라 본류 비차단.
- **`producer.ts`**: `emitWorkPackages(deps, wf, wps, oracleDrafts=[])`가 payload에 `oracleDrafts` 포함. **ok 경로만 `result.oracleDrafts` 전달** — inconsistent/기술 fallback 경로는 `[]`(blocker#5: 그 경로 WP는 수동 오라클 대기, degraded).
- **draft flag**: `ProduceDeps.draftOracles?: boolean`(server.ts가 `config.MANAGER_ORACLE_DRAFT` 주입).

### 3.4 소비·영속

- **`decomposition-consumer.ts` `handleDecompositionEmitted`**: TaskGraph upsert 성공 후, `deps.oracleStore`가 있으면 각 `msg.payload.oracleDrafts`를 `oracleStore.upsertDraft({ workflowId, storyId, scenarios, coverage })`로 영속. oracleId는 repo가 `oracle-{workflowId}-{storyId}`로 구성. 빈 배열/미주입이면 skip(비차단). `DecompositionDeps`에 optional `oracleStore: { upsertDraft }` 추가.
- **`OracleRepo.upsertDraft`(신규·멱등, blocker#6)**: `INSERT (oracle_id, workflow_id, story_id, version, status, scenarios, coverage) VALUES (..., 1, 'pending', ...) ON CONFLICT (oracle_id) DO UPDATE SET scenarios=EXCLUDED.scenarios, coverage=EXCLUDED.coverage, status='pending' WHERE oracles.status='pending'`. **version++ 안 함**(재시도/재분해 시 pending 드래프트만 멱등 덮어쓰기 — version 인플레 방지). 이미 approved/superseded면 WHERE로 보존(승인된 오라클을 드래프트가 덮지 않음). 기존 `upsert`(API용·version++)는 유지.
- **Supervisor**(`supervisor.ts`): `createSupervisor`가 `oracleStore`(OracleRepo, upsert·upsertDraft·approvedByWorkflow 모두 보유)를 `DecompositionConsumer`에 주입(upsert용). **dispatch satisfied-set 주입과 oracleConsumer 배선은 `SupervisorConfig.oracleDor`(=`MANAGER_ORACLE_DOR`)로 게이트** — DoR off·DRAFT on이면 드래프트는 영속되나 게이트는 비활성(blocker#1 의도된 분리). `SupervisorDeps.oracleStore` 타입은 `upsertDraft`+`approvedByWorkflow`를 모두 노출(blocker#2).

### 3.5 approve 루프 닫기 (`db/oracle.repo.ts`)

- **`OracleRepo.approve` 수정**: 같은 tx에서 ①`SELECT workflow_id, story_id, version, status, scenarios FROM oracles WHERE oracle_id=$1 FOR UPDATE` ②**`status !== 'pending'`(미존재·approved·superseded 포함)이면 rollback·null 반환**(blocker#8: superseded 재승인 차단) ③JS에서 `drafted`→`human_approved` 전이(다른 status 불변) ④`UPDATE oracles SET status='approved', scenarios=$transitioned, approved_at, approved_by` ⑤manager_events(oracle.approved) ⑥manager_outbox. 전이는 **무조건**(drafted 없으면 scenarios 불변=no-op·P3-1 회귀 0).
- 멱등키·아웃박스 스트림·ROLLBACK 가드는 P3-1 그대로. scenarios 파싱은 `OracleScenarioSchema.array().parse`(불량 레거시 JSON은 throw→롤백·승인 거부; 권고#2 에러경로 테스트).

## 4. 플래그 & 가역성

- **`MANAGER_ORACLE_DRAFT`**(기본 `false`·가역): on이면 decompose 파이프라인이 draft 스테이지 실행 + producer가 oracleDrafts emit. off면 `oracleDrafts=[]`·스테이지 미호출·**회귀 0**.
- **oracleStore 주입(blocker#1 분리)**: `server.ts`는 `pool && (MANAGER_ORACLE_DOR || MANAGER_ORACLE_DRAFT)`이면 `OracleRepo`를 만들어 `createSupervisor`에 주입 → **DRAFT만 켜도 consumer upsert 동작**. `createSupervisor`는 `SupervisorConfig.oracleDor`(=`MANAGER_ORACLE_DOR`)로 satisfied-set 주입·oracleConsumer 배선을 게이트(DoR 게이트는 DOR일 때만).
- `MANAGER_DECOMPOSE_ENABLED`(분해 생산자)·`TASK_MANAGER_ENABLED`(Supervisor) 전제 위에 얹힘.
- approve 전이는 flag 무관(always-on·additive).

## 5. 테스트

- **`draftOracles`**(StageDeps mock): 커버리지 완전(모든 AC) · LLM 미커버 AC stub · LLM 실패 fallback(AC별 stub) · 시나리오 상한 절단 · 결정론(scenario id).
- **스키마**: given/when/then 기본값 · OracleDraft(oracleId 없음) 파싱.
- **`OracleRepo.upsertDraft`**(mock pool): pending INSERT · ON CONFLICT 멱등 갱신(version 불변) · approved 보존(WHERE status='pending').
- **`OracleRepo.approve`**(mock pool): SELECT FOR UPDATE→전이→UPDATE 단일 tx · drafted→human_approved 일괄 · rejected/human_approved 불변 · drafted 없으면 no-op · **status≠pending(approved·superseded·미존재)이면 null·이벤트 미적재** · 멱등키 · **기존 outbox 스트림 단언 보존**(권고#1).
- **`handleDecompositionEmitted`**: oracleDrafts 있으면 upsertDraft 호출(oracleId 파생 검증) · 미주입/빈 배열 skip · TaskGraph 영속 회귀 0 · **타입드 픽스처 oracleDrafts 채움**(blocker#9).
- **`pipeline`/`producer`**: ok면 oracleDrafts 포함 · off면 `[]` · fallback/inconsistent 경로 `[]`(blocker#5).
- **Supervisor**: oracleStore 주입 + `oracleDor=false`면 oracleConsumer 미배선·consumer는 upsert 가능 / `oracleDor=true`면 둘 다.
- **`config`**: `MANAGER_ORACLE_DRAFT` 기본 false·`'true'`→true.
- **DB-level 통합 테스트(skip-if-no-DB, blocker#10)**: `upsertDraft(drafted)` → `approve`(전이) → `approvedByWorkflow` → `oracleSatisfiedSet`이 그 WP를 satisfied로 산출 — 루프(영속→승인→DoR 충족)를 실 Postgres로 실증.

## 6. 위험 & 완화

- **초안 품질**: LLM 시나리오 부정확 가능 — 사람 검토·승인이 권위(M2). 부정확 초안도 stub 커버리지로 DoR은 충족되나 사람이 거부·편집(후속)로 정련.
- **커버리지 stub의 공허함**: stub은 AC 문구만 담아 실행 불가(N1 step-def 미컴파일). DoR 게이트(존재·승인)는 통과하나 실제 검증 오라클은 Phase 4. P3-2는 디스패치 언블록까지가 목표.
- **oracleId 충돌 해소(blocker#3)**: oracleId=`oracle-{workflowId}-{storyId}`로 워크플로 스코프. storyId 재분해 불안정 시 같은 워크플로 내 중복은 `upsertDraft` 멱등(pending 덮어쓰기)으로 흡수. 정식 안정 storyId는 분해 레이어 후속.
- **재분해 dedup 한계(blocker#4·인계)**: `decomposition.emitted` 봉투가 `attemptId:0` 고정이라, 같은 workflowId 재분해는 M6 dedup(24h)에 의해 재시도로 간주돼 버려질 수 있다. **이는 P2 생산자 기존 동작이며 P3-2가 도입한 것 아님**(재분해 트리거 자체가 미배선). 재분해 배선 시 attemptId를 분해 시도별로 증가시켜 해소 — **P3-2 범위 외·문서화**.
- **부분 영속 복원(blocker#6)**: graph upsert와 draft upsert는 별 tx이나, `upsertDraft`가 멱등(version 불변·pending 덮어쓰기)이라 BaseConsumer 재시도가 안전(version 인플레 없음). graph upsert version++ 재시도 인플레는 **P1d-2 기존 패턴**(인계·M6 dedup이 정상 재전달은 차단).

## 7. 완료 정의 (수용 기준)

①`draftOracles`(커버리지 보장·상한·fallback)+테스트 ②스키마 additive(given/when/then·OracleDraft·payload)+회귀 0 ③pipeline/producer flag(ok만 채움) ④consumer `upsertDraft`(멱등·oracleId 파생) ⑤`approve` 전이(pending 가드·무조건 전이·no-op 안전) ⑥`MANAGER_ORACLE_DRAFT` flag + oracleStore 분리 배선 ⑦DB-level 통합 테스트(영속→승인→DoR 충족) ⑧**문서 최신화: CLAUDE.md(root/manager)·README.md·`docs/`·AGENTS.md(존재 시)**(blocker#11·전역 규칙) ⑨build·test·jscpd 0·audit 0.

## 8. Codex 검증 반영 (2026-06-09)

| # | 지적 | 반영 |
|---|---|---|
| B1 | DRAFT만 켜면 oracleStore 미주입→영속 안 됨 | §3.4·§4: oracleStore를 `DOR\|\|DRAFT`로 주입, DoR 게이트만 `oracleDor` config로 분리 |
| B2 | `SupervisorDeps.oracleStore`가 approvedByWorkflow만 노출→타입 실패 | §3.4: 타입을 `upsertDraft+approvedByWorkflow` 노출(OracleRepo)로 |
| B3 | `oracle-{storyId}` 워크플로 비스코프→PK 충돌 | §3.1·§3.4: oracleId=`oracle-{workflowId}-{storyId}`(consumer 파생) |
| B4 | attemptId:0 dedup→재분해 폐기 | §6: P2 기존 동작·재분해 미배선이라 **범위 외 문서화** |
| B5 | draft-stage 실패→fallback이 oracleDrafts=[] | §2.3·§3.3: 커버리지 보장=ok 경로 명시, fallback=[] degraded |
| B6 | graph+draft 별 tx→부분 상태·version 인플레 | §3.4·§6: `upsertDraft` 멱등(version 불변)·재시도 안전 |
| B7 | payload 무한정 vs 10MiB skip | §3.1: story당 시나리오 상한(MAX 8) |
| B8 | approve가 approved만 거부→superseded 재승인 | §3.5: `status!=='pending'`이면 거부 |
| B9 | `.default([])`로 출력 타입 변경→픽스처 컴파일 실패 | §3.2·§5: 타입드 픽스처에 oracleDrafts 채움 |
| B10 | e2e 통합 테스트 부재 | §5·§7: DB-level 통합 테스트 추가(영속→승인→DoR) |
| B11 | 문서 작업이 CLAUDE.md 2개만 | §7: README·docs·AGENTS(존재 시)까지 확장 |
| N1 | 동시 이중 승인 미검증·outbox 단언 누락 | §5: outbox 단언 보존(동시성 테스트는 후속) |
| N2 | scenarios parse throw 에러경로 | §3.5·§5: 에러경로 테스트 |
