# C3 오라클 승인 UI 설계 (C1 재사용·C5 패턴 미러)

- 날짜: 2026-06-23
- 상태: 승인됨 (구현 대기)
- 범위: xzawedManager(`streams/oracle-brief.ts`·`decomposition-consumer.ts`·`decision-consumer.ts`·`db/oracle.repo.ts`·`supervisor.ts`·`server.ts`·`config.ts`). **Orchestrator/UI 변경 0**(C1 DecisionsPanel 재사용).

## 1. 배경·문제

post-#332 재감사가 지목한 **최고가치 누락 HITL 표면(C3)**: P3-2가 draft GWT 오라클을 자동 생성(pending)하나 **사람이 승인할 UI가 없다** — 오라클 승인은 `PATCH /oracles/:id/approve`(서비스 토큰·client-supplied `approvedBy`·비부인 없음)뿐이고, `oracle_approval` DecisionRequest 타입은 enum에만 있고 **생산자가 0개**다. 따라서 DoR/conformance/impact/property 검증 체인 전체가 **사람이 UI로 못하는 승인**에 묶여 있다. C6(#337) 머지로 분해→오라클 생성 경로가 런타임 도달 가능해진 지금, C3가 오라클 승인을 **C1 결정 대기함에 surface**해 사람이 앱에서 승인 → DoR 충족 → 디스패치 언락을 가능하게 한다. C5(리스크 승인 #318)와 동일한 백엔드 패턴.

## 2. 목표·비목표

**목표**: 분해가 draft 오라클을 영속할 때 **per-workflow `oracle_approval` DecisionRequest**를 발행해 C1이 surface → 사람 승인(JWT `decidedBy` 비부인) → 그 workflow의 pending 오라클 전부 `drafted→human_approved` → `oracle.approved` 재디스패치 → DoR 충족. `MANAGER_ORACLE_DECISION` off→회귀 0.

**비목표(YAGNI·후속)**:
- **per-story 개별 승인**(스토리별 카드·oracleId 스레딩) — per-workflow 배치 승인이 MVP.
- 오라클 GWT 시나리오 상세 리뷰 UI·reject 능동 재생성(reject=no-op·보류 유지).
- Orchestrator/C1 UI 변경(타입-무관 surface 재사용).

## 3. 결정(승인됨)

1. **Granularity = per-workflow**: 워크플로당 `oracle_approval` 1개 → approve 시 그 workflow의 pending 오라클 **전부** 승인. "한 번 승인이 디스패치를 연다"(P3-2 목표)·C5(per-workflow) 미러·`req.workflowId`만으로 충분(oracleId 스레딩 0).
2. **생산자 = decomposition-consumer**(draft 영속 지점). `decisionStore` 주입 시 emit(flag 게이트).
3. **`MANAGER_ORACLE_DECISION` flag**(전제 `MANAGER_ORACLE_DRAFT`+`MANAGER_DECISION_ROUTING`+`DATABASE_URL`)·off→회귀 0. JWT `decidedBy` 비부인·C1 재사용.

## 4. 아키텍처

### 4.1 oracle-brief (`streams/oracle-brief.ts` 신규)
`risk-brief.ts` 미러. `RiskClassification` 대신 `{workflowId, projectId, storyCount}` 입력:
```ts
export interface OracleBriefInput { workflowId: string; projectId: string | null; storyCount: number }
export function buildOracleBrief(input: OracleBriefInput): DecisionRequestInput {
  return {
    requestId: `${input.workflowId}:oracle`,
    type: 'oracle_approval',
    workflowId: input.workflowId,
    correlationId: input.workflowId,
    wpId: null,
    severity: 'blocking',
    projectId: input.projectId,
    context: {
      location: `오라클 승인 (${input.storyCount} 스토리)`,
      expectedVsActual: `자동 생성된 GWT 오라클 ${input.storyCount}건. 승인하면 모든 스토리의 오라클이 human_approved로 전이되어 DoR을 충족하고 디스패치가 열립니다. 거부하면 보류됩니다.`,
      options: ['approve', 'reject'],
    },
  }
}
```
requestId=`{wf}:oracle` 결정론 → `createRequest` ON CONFLICT 멱등(재분해 시 원 요청 보존).

### 4.2 생산자 (`decomposition-consumer.ts`)
- `DecompositionDeps.decisionStore?: { createRequest(input: DecisionRequestInput): Promise<unknown> }` additive.
- `handleDecompositionEmitted`에서 oracle draft upsert 루프(현 113-122) **직후**: `oracleStore && decisionStore && oracleDrafts.length > 0`이면 `decisionStore.createRequest(buildOracleBrief({ workflowId, projectId: msg.payload.userContext?.projectId ?? null, storyCount: msg.payload.oracleDrafts.length }))`. best-effort(never-throw 래핑 — 브리프 발행 실패가 영속을 깨지 않음).
- `buildDecompositionConsumerHandler`/`DecompositionConsumer` 생성자에 `decisionStore?` 인자 additive(oracleStore 옆).

### 4.3 OracleRepo (`db/oracle.repo.ts`)
- `approvePendingByWorkflow(workflowId: string, approvedBy: string): Promise<{ approved: number }>`(신규): `listByWorkflow(workflowId, 'pending')` 순회하며 기존 `approve(oracleId, approvedBy)` 호출(각 단일 tx·drafted→human_approved+oracle.approved 이벤트). 성공 카운트 반환. approve가 null(이미 승인 등) 반환하면 skip. never-throw 불필요(상위 consumer가 best-effort).

### 4.4 소비자 (`decision-consumer.ts`)
- `DecisionRoutingDeps.oracleStore?: { approvePendingByWorkflow(workflowId: string, approvedBy: string): Promise<{ approved: number }> }` additive.
- approve 분기(현 84-88)를 type 분기로 확장(risk_classification·oracle_approval):
```ts
if (p.data.choice === 'approve' && p.data.decidedBy) {
  const req = await deps.decisionStore.getRequest(p.data.requestId)
  if (req?.type === 'risk_classification' && deps.riskStore) {
    await deps.riskStore.approve(req.workflowId, p.data.decidedBy)
  } else if (req?.type === 'oracle_approval' && deps.oracleStore) {
    await deps.oracleStore.approvePendingByWorkflow(req.workflowId, p.data.decidedBy)
  }
}
```
(기존 risk 동작 보존·never-throw catch 불변.)

### 4.5 배선 (`supervisor.ts`·`server.ts`·`config.ts`)
- `config.ts`: `MANAGER_ORACLE_DECISION`(기본 false).
- `shouldWireOracleDecision(config)` 순수 게이트(`MANAGER_ORACLE_DECISION` && `MANAGER_ORACLE_DRAFT` && `MANAGER_DECISION_ROUTING`)·DB는 server가 보장.
- `server.ts`: `MANAGER_ORACLE_DECISION`+pool+oracleStore(이미 DOR/DRAFT/CONFORMANCE 시 생성됨)+decisionStore(DECISION_ROUTING 시 생성됨)이면 `createSupervisor`에 `oracleDecision: true` 전달. OutboxRelay 기동 조건에 ORACLE_DECISION 추가(oracle.approved 아웃박스 발행 필수 — 기존 DOR도 포함하나 명시).
- `createSupervisor`(`SupervisorConfig.oracleDecision`):
  - oracleDecision이면 `decompositionConsumer`에 `decisionStore` 주입(생산자 활성).
  - oracleDecision이면 `DecisionRecordedConsumer` deps에 `oracleStore` 주입(approve 활성).
  - 미주입(flag off)이면 양쪽 silent-no-op seam 비배선 → 회귀 0.

## 5. 데이터 흐름

```
decompose → decomposition.emitted(oracleDrafts) → handleDecompositionEmitted
  → upsertDraft(pending) × N stories
  → [decisionStore] createRequest(oracle_approval {wf}:oracle)  → C1 DecisionsPanel(타입-무관 surface)
  → 사람 approve(decidedBy=JWT subject) → POST /projects/:id/decisions/:reqId/decision
  → DecisionRecordedConsumer(approve+oracle_approval) → OracleRepo.approvePendingByWorkflow
  → listByWorkflow(pending) → approve each → drafted→human_approved + oracle.approved × N
  → oracle-consumer 재디스패치(P3-1) → oracleSatisfiedSet → DoR 충족 → 디스패치 언락
```

## 6. 에러 처리·엣지

- **flag off**: decisionStore/oracleStore 미주입 → 생산자·소비자 양쪽 비배선 → 회귀 0.
- **브리프 발행 실패**: best-effort never-throw(영속/분해 비차단). DecisionRequest 미생성 시 사람 도달 없음(다음 재분해·운영 수동 PATCH 폴백).
- **재분해**: `{wf}:oracle` requestId 멱등(`createRequest` ON CONFLICT DO NOTHING)·원 요청 보존.
- **승인 후 pending 0**: approvePendingByWorkflow가 `{approved:0}`(no-op)·무해.
- **oracle.approved 아웃박스**: OutboxRelay 기동 필요(이미 DOR/DRAFT 조건에 포함·ORACLE_DECISION 명시 추가).
- **reject**: no-op(보류 유지·기존 decision-consumer 동작). 만료는 B1 TTL(MANAGER_DECISION_EXPIRY).

## 7. 테스트

- **`oracle-brief.test.ts`**(신규): `buildOracleBrief` — requestId `{wf}:oracle`·type `oracle_approval`·options approve/reject·projectId 전파·storyCount 반영.
- **`decomposition-consumer` 단위**: decisionStore+oracleStore+drafts → createRequest(oracle_approval) 호출 / decisionStore 미주입 → 미호출(회귀 0) / drafts 0 → 미호출.
- **`decision-consumer` 단위**: approve+oracle_approval+oracleStore → approvePendingByWorkflow(workflowId, decidedBy) 호출 / risk_classification 기존 경로 보존 / oracleStore 미주입 → no-op.
- **`OracleRepo.approvePendingByWorkflow`**(DB 통합·skip-if-no-DB): upsertDraft×2(pending) → approvePendingByWorkflow → 둘 다 approved+human_approved 전이·`{approved:2}`.
- **E2E DB 통합**(skip-if-no-DB): decomposition.emitted(drafts)→createRequest→approve→approvePendingByWorkflow→oracleSatisfiedSet 충족(승인→DoR 루프).

## 8. 수용 기준

1. 분해가 draft 오라클 영속 시 `oracle_approval` DecisionRequest(`{wf}:oracle`)가 발행되어 C1에 surface(생산자 첫 활성).
2. 사람 approve(JWT decidedBy) → 그 workflow pending 오라클 전부 human_approved → oracle.approved 재디스패치 → DoR 충족.
3. **Orchestrator/UI 변경 0**(C1 타입-무관 재사용)·기존 risk_classification approve 경로 회귀 0.
4. `MANAGER_ORACLE_DECISION` off→생산자·소비자 비배선·회귀 0·migration 0.

## 9. 영향 파일

- `xzawedManager/packages/server/src/streams/oracle-brief.ts`(신규)+`oracle-brief.test.ts`
- `streams/decomposition-consumer.ts`(decisionStore·emit)+test
- `db/oracle.repo.ts`(approvePendingByWorkflow)+통합 test
- `streams/decision-consumer.ts`(oracleStore·approve 분기)+test
- `streams/supervisor.ts`(배선·shouldWireOracleDecision)·`server.ts`(flag·stores)·`config.ts`(MANAGER_ORACLE_DECISION)
- `test/*.integration.test.ts`(승인 루프·skip-if-no-DB)
- 문서: 작업 완료 후 CLAUDE.md(루트·Manager)+`MANAGER_ORACLE_DECISION` env.

## 10. 후속(이 슬라이스 밖)
- per-story 개별 오라클 승인·GWT 시나리오 상세 리뷰 UI·reject 능동 재생성·oracle 승인 카드 type 배지(#333 type_* 확장).
