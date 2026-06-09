# P3-2 Oracle 초안 생성 (P7) — 사람 작성 부담 흡수 설계

> Phase 3 둘째 슬라이스. [[P3-1]](`2026-06-09-p3-1-oracle-dor-gate-design.md`)이 연 디스패치 게이트의 **사람 병목**(오라클 백지 작성)을 흡수한다. senario `ORACLE_SCHEMA.md` §10(작성 흐름: PM이 초안→사람 승인) 구체화.
> 목표: 분해가 산출한 각 Story에 대해 PM(LLM)이 Given-When-Then 시나리오 **초안**을 생성해 `pending` 오라클로 영속한다. 사람은 백지 작성이 아니라 **초안을 검토·승인**(PATCH approve 한 번)만 하면 DoR이 충족돼 dispatch가 열린다.

## 1. 배경 — P3-1이 남긴 사람 병목

P3-1로 디스패치 게이트는 열렸으나, DoR 충족(§8: 각 acceptance_criterion을 덮는 `human_approved` 시나리오 ≥1)을 위해 **사람이 오라클 시나리오를 처음부터 작성**해야 한다(P3-1 리뷰 "human_approved 시드 필요"). P3-2는 이 작성을 LLM 초안으로 대체하고, 승인 한 번으로 초안을 `human_approved`로 전이해 루프를 닫는다.

`ORACLE_SCHEMA.md §10`: *PM(Opus)이 Story에서 시나리오·불변식 초안 → 사람이 검토·수정·승인 → approved oracle vN 고정.* P3-2 = 이 흐름의 초안 생성 + 승인 전이.

## 2. 범위 & 결정 (브레인스토밍 2026-06-09)

**포함**: ①분해 파이프라인 P7 draft 스테이지(LLM) ②`decomposition.emitted`에 `oracleDrafts` 합류 ③consumer가 `OracleRepo.upsert`(pending) ④`OracleRepo.approve`가 drafted→human_approved 일괄 전이 ⑤`MANAGER_ORACLE_DRAFT` flag.

**제외(후속)**: 시나리오별 개별 승인/거부 UI · invariant/golden 초안 · LLM step-definition 컴파일(N1 실행 바인딩) · 오라클 편집 UI.

### 핵심 결정
1. **분해 파이프라인 스테이지**: P7 초안 생성을 decompose 파이프라인의 LLM 스테이지로 추가(producer=LLM·DB없음 / consumer=DB·LLM없음 분리 유지). producer가 `decomposition.emitted` payload에 `oracleDrafts`를 additive로 실어 보내고, Supervisor consumer가 TaskGraph와 함께 `OracleRepo.upsert`.
2. **approve가 일괄 전이**: `PATCH /oracles/:id/approve`가 oracle status=approved와 함께 그 oracle의 `drafted` 시나리오를 **같은 tx에서 `human_approved`로 일괄 전이**(사람이 oracle 승인 = 초안 시나리오 수용·M2 사람 권위). 일부 거부는 approve 전 편집(후속). **무조건·additive** — drafted 없으면 no-op(P3-1 수동 경로 회귀 0).
3. **커버리지 보장**: draft 스테이지는 모든 AC를 ≥1 시나리오로 덮음(미커버 시 stub 합성). 승인 후 DoR 충족을 결정론적으로 보장.

## 3. 컴포넌트 & 데이터 흐름

```
decompose 파이프라인 (producer·LLM):
  epics → slice(stories) → deliverables → roles → [P7 draftOracles] → emit
  decomposition.emitted { workPackages, oracleDrafts }   ← oracleDrafts additive

Supervisor consumer (DB):
  handleDecompositionEmitted → TaskGraph upsert
                            → OracleRepo.upsert(oracleDrafts, status=pending·scenarios drafted)

[사람] PATCH /oracles/:id/approve
  같은 tx: oracles.status=approved + scenarios drafted→human_approved + oracle.approved 이벤트
  → OutboxRelay → oracleConsumer → handleDispatch → coveredCriteria 충족 → ready WP dispatch
```

### 3.1 Draft 스테이지 (`decompose/stages/draft-oracles.ts`)

```ts
export interface OracleDraft {
  oracleId: string          // 'oracle-{storyId}' (워크플로 내 결정론·재분해 upsert version++)
  storyId: string
  scenarios: DraftScenario[] // status:'drafted'
  coverage: Record<string, string[]>  // acceptance_criterion → [scenarioId]
}
export async function draftOracles(stories: Story[], deps: StageDeps): Promise<OracleDraft[]>
```

- story별로 `runStage`(callClaudeText→JSON→safeParse→fallback) 1회 호출 — LLM이 그 story의 `acceptanceCriteria`를 덮는 Given-When-Then 시나리오 초안 + coverage 생성.
- **커버리지 보장**: LLM 결과에서 미커버 AC가 있으면 그 AC를 덮는 **stub 시나리오**(`{id, title:AC, given:[], when, then:[], status:'drafted'}`)를 합성해 coverage 완전화. `runStage` fallback(LLM 실패·파싱 실패) = story의 AC별 stub 1개.
- 결정론 보강: scenario id = `{storyId}-sc{n}`(순번), oracleId = `oracle-{storyId}`.

### 3.2 스키마 (additive)

- **`OracleScenarioSchema` 확장**(`db/oracle.types.ts`): `given: z.array(z.string()).default([])`·`when: z.string().default('')`·`then: z.array(z.string()).default([])` optional 추가. **satisfied-set은 status+coverage만 소비** — given/when/then은 사람 검토용. P3-1 회귀 0(전부 기본값).
- **`OracleDraftSchema`**: `{ oracleId, storyId, scenarios: OracleScenarioSchema[], coverage }`.
- **`DecompositionEmittedSchema` payload 확장**(`streams/decomposition-consumer.ts`): `{ workPackages, oracleDrafts: z.array(OracleDraftSchema).default([]) }` — additive·기존 메시지(oracleDrafts 없음)도 `.default([])`로 통과(P1d-2/P2 회귀 0).

### 3.3 파이프라인·발행

- **`pipeline.ts` `runDecomposition`**: `assignRoles` 후 `StageDeps`에 draft flag가 on이면 `draftOracles(stories, deps)` 호출 → `DecomposeResult`(ok 분기)에 `oracleDrafts: OracleDraft[]` 추가(off면 `[]`). draft 실패는 비차단(빈 배열·로그) — 분해 본류를 막지 않음.
- **`producer.ts`**: `emitWorkPackages`가 payload에 `oracleDrafts` 포함(`{ workPackages, oracleDrafts }`). flag off면 `[]`.
- **draft flag 전달**: `ProduceDeps`·`StageDeps`에 `draftOracles?: boolean`(server.ts가 `config.MANAGER_ORACLE_DRAFT` 주입). off면 스테이지 미호출.

### 3.4 소비·영속

- **`decomposition-consumer.ts` `handleDecompositionEmitted`**: TaskGraph upsert 성공 후, `msg.payload.oracleDrafts`가 있고 `oracleStore` 주입됐으면 각 draft를 `OracleRepo.upsert`(status pending). DB 미주입/빈 배열이면 skip(비차단). `DecompositionDeps`에 optional `oracleStore` 추가.
- **Supervisor**(`supervisor.ts`): `createSupervisor`가 `oracleStore`(P3-1 재사용)를 `DecompositionConsumer`에 주입(현재 afterPersisted=디스패치만 주입 → oracleStore 추가). `MANAGER_ORACLE_DRAFT` 무관하게 oracleStore 있으면 upsert(드래프트 페이로드 있을 때만 동작).

### 3.5 approve 루프 닫기 (`db/oracle.repo.ts`)

- **`OracleRepo.approve` 수정**: 같은 tx에서 ①`SELECT scenarios FROM oracles WHERE oracle_id=$1 FOR UPDATE` ②JS에서 `drafted`→`human_approved` 전이(다른 status 불변) ③`UPDATE oracles SET status='approved', scenarios=$transitioned, approved_at, approved_by` ④manager_events(oracle.approved) ⑤manager_outbox. 전이는 **무조건**(drafted 없으면 scenarios 불변=no-op·P3-1 회귀 0). `rejected`/이미 `human_approved`는 유지.
- 멱등키·아웃박스 스트림·ROLLBACK 가드는 P3-1 그대로.

## 4. 플래그 & 가역성

- **`MANAGER_ORACLE_DRAFT`**(기본 `false`·가역): on이면 ①decompose 파이프라인이 draft 스테이지 실행 ②producer가 oracleDrafts emit ③consumer upsert. off면 `oracleDrafts=[]`·스테이지 미호출·**회귀 0**.
- `MANAGER_DECOMPOSE_ENABLED`(분해 생산자) + `MANAGER_ORACLE_DOR`(DoR 게이트·oracleStore) 위에 얹힘. draft만 켜고 DoR off면 drafts는 영속되나 게이트 미적용(무해).
- approve 전이는 flag 무관(always-on·additive).

## 5. 테스트

- **`draftOracles`**(StageDeps mock): story별 커버리지 완전(모든 AC 덮음) · LLM 미커버 AC stub 합성 · LLM 실패 fallback(AC별 stub) · 결정론(scenario id·oracleId).
- **`OracleScenarioSchema`/`OracleDraftSchema`**: given/when/then 기본값 · draft 파싱.
- **`OracleRepo.approve` 전이**(mock pool): drafted→human_approved 일괄 · rejected/human_approved 불변 · drafted 없으면 scenarios 불변(no-op) · 전이가 approve tx 안에서 일어남.
- **`handleDecompositionEmitted`**: oracleDrafts 있으면 upsert 호출 · oracleStore 미주입/빈 배열이면 skip · TaskGraph 영속 회귀 0.
- **`pipeline`/`producer`**: flag on이면 oracleDrafts 포함 · off면 `[]`(회귀 0) · draft 실패 비차단.
- **`config`**: `MANAGER_ORACLE_DRAFT` 기본 false·`'true'`→true.

## 6. 위험 & 완화

- **초안 품질**: LLM 시나리오가 부정확할 수 있음 — 사람 검토·승인이 권위(M2). 부정확 초안도 stub 커버리지로 DoR은 충족되나, 사람이 거부·편집(후속 UI)로 정련. 현재는 bulk-approve(한 번에 수용) — 정밀 거부는 후속.
- **커버리지 stub의 공허함**: stub 시나리오는 AC 문구만 담아 "실행 가능"하지 않음(N1 step-def 미컴파일). DoR 게이트(존재·승인)는 통과하나 실제 검증 오라클은 Phase 4. P3-2는 **디스패치 언블록**까지가 목표(검증 아님).
- **재분해 시 oracleId 안정성**: oracleId=`oracle-{storyId}`이므로 storyId가 재분해 간 불안정하면 중복 oracle 가능 — upsert version++로 흡수, 정식 안정 storyId는 분해 레이어 후속.
- **payload 크기**: oracleDrafts가 decomposition.emitted를 키움 — story 수×시나리오. 현실적 규모(수십)라 무해, 과대 시 별도 스트림 분리 후속.

## 7. 완료 정의 (수용 기준)

①`draftOracles` 스테이지(커버리지 보장·fallback) + 테스트 ②스키마 additive 확장(given/when/then·OracleDraft·payload) + P3-1/P2 회귀 0 ③pipeline/producer flag 통합 ④consumer upsert(pending) ⑤`approve` drafted→human_approved 전이(무조건·no-op 안전) ⑥`MANAGER_ORACLE_DRAFT` flag ⑦**end-to-end: 분해(draft on)→pending 오라클 영속→PATCH approve→DoR 충족→dispatch**(수동/통합 검증) ⑧build·test·jscpd 0·audit 0.
