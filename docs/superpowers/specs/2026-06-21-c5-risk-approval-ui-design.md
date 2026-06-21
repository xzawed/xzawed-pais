# C5 — 리스크 승인 UI (C1 결정 대기함 재사용)

**날짜**: 2026-06-21
**상태**: 설계 승인됨(브레인스토밍 → 본 스펙)
**원천 스펙**: `docs/senario/WIKI_AGENT_RISK_CLASSIFICATION.md` §4(사람 게이트)·`docs/superpowers/specs/2026-06-20-c0c1-decision-ui-design.md`(C0/C1 결정 UI)·P5-2a 사인오프(표준 DecisionContext 매핑)
**선행 슬라이스**: P2r-3 생산자(#314·pending 분류)·P2r-4 승인 라우팅+wp.risk write-back(#316)·C0/C1 결정 UI(#303/#306)·P5-2a(#308)

## 배경

P2r-3(#314)→P2r-4(#316)로 **사람이 리스크 분류를 승인하면 wp.risk가 채워져 mutation θ게이트가 발화**하는 백엔드 폐루프가 완성됐다. 그러나 승인은 **API(PATCH approve)만** 있어 사람이 in-product로 구동할 수 없다(C-track UI 부재). 또한 P2r-4 승인 라우트의 `approvedBy`는 body 문자열이라 **사람 비부인이 약하다**(approvedBy-forge·P2r-4 리뷰 Minor#1).

C5는 리스크 승인을 **기존 C1 결정 대기함(DecisionsPanel)에 surface**해 사람이 승인하게 한다. P5-2a가 `degraded_release`로 검증한 **표준 DecisionContext 매핑** 키스톤의 확장이며, 승인이 C1 프록시의 **JWT decidedBy 주입**을 거쳐 **실 사람 비부인**을 획득한다.

## 범위 결정 (브레인스토밍 확정·Approach A)

- **C1 결정 대기함 재사용**(별도 패널 아님): 리스크 분류 승인을 `risk_classification` DecisionRequest로 매핑.
- **humanGate.required만 발행**: HIGH·고stakes 저confidence·컴플라이언스 불확실만 승인 대기(LOW/MED는 mutation 무관·승인 불요).
- **실 사람 비부인**: 승인이 결정 경로(C1 프록시→decidedBy=JWT subject)를 거쳐 `RiskClassificationRepo.approve(workflowId, decidedBy)` → P2r-4의 approvedBy-forge 약점을 봉합.
- **패널 stale-label 부채 동시 해소**: DecisionsPanel을 `context.options` 구동 렌더로 리팩터.

## 아키텍처 (데이터 흐름)

```
P2r-3 produceRiskClassification (humanGate.required)
  → decisionStore.createRequest(buildRiskBrief)        ★C5·best-effort·flag
  → C1 DecisionsPanel surface (context.options=['approve','reject'])
  → 사람 "승인" → Orchestrator decisions 프록시(decidedBy=인증 JWT subject)
  → Manager decision.route POST (choice=approve)
  → DecisionRepo.recordDecision → decision.recorded
  → DecisionRecordedConsumer: risk_classification + approve
  → RiskClassificationRepo.approve(req.workflowId, decidedBy)   ★실 비부인
  → risk.approved → RiskApprovedConsumer → updateWpRisks (P2r-4)
  → wp.risk=HIGH → mutation θ게이트 발화
```

### Manager 변경

| 파일 | 종류 | 책임 |
|---|---|---|
| `db/decision.types.ts` | 수정 | `DecisionRequest.type` enum에 `risk_classification` 추가 · `HumanDecision.routedTo` enum에 `risk_approve` 추가 |
| `streams/risk-brief.ts` | 신규 | `buildRiskBrief(input, projectId?)` — `RiskClassification`을 표준 `DecisionContext`로 매핑(signoff-brief 미러). type `risk_classification`·options `['approve','reject']`·requestId `{workflowId}:risk:{version}` 결정론 멱등 |
| `db/risk-classification.repo.ts` | 수정(additive) | `upsert`가 `Promise<{version: number}>` 반환(`RETURNING version`·재채점 시 version++ 노출 — requestId 멱등 입력). 기존 호출자(void 기대)는 반환 무시라 회귀 0 |
| `decompose/risk-producer.ts` | 수정(additive) | `produceRiskClassification`이 `repo.upsert`(version 수신) 후 `classification.humanGate.required && deps.decisionStore`면 `decisionStore.createRequest(buildRiskBrief(..., version))` best-effort 발행(never-throw 경계 안) |
| `streams/decision-consumer.ts` | 수정(additive) | `buildDecisionRecordedHandler`에 `choice==='approve' && req.type==='risk_classification' && riskStore`면 `riskStore.approve(req.workflowId, decidedBy)` 분기(accept_known→recordSignOff 미러). `DecisionRoutingDeps.riskStore?` 추가 |
| `api/decision.route.ts` | 수정 | BodySchema choice enum에 `approve` 추가 · `CHOICE_TO_ROUTED['approve']='risk_approve'` |
| `config.ts`·`server.ts`·`supervisor.ts` | 수정(배선) | `MANAGER_RISK_DECISION` flag · producer에 `decisionStore` 주입(emit) · decision-consumer에 `riskStore` 주입(approve 분기) |

### Orchestrator 변경 (최소·부채 해소)

| 파일 | 종류 | 책임 |
|---|---|---|
| `components/DecisionsPanel.tsx` | 수정(리팩터) | 하드코딩 `CHOICES` 4개 → **`d.context?.options` 구동 렌더**(없으면 기존 4 fallback·backward-compat). **stale "나머지는 기록만" 블랭킷 라벨 제거** → 정직한 일반 hint(`decisions.choice_hint`). 알 수 없는 choice는 i18n 키 fallback |
| `locales/{ko,en,ja}/app.json` | 수정 | `decisions.choice_approve` 라벨 추가 · `decisions.choice_hint`(블랭킷 stale 라벨 대체) |

- **프록시(`decisions.route.ts`)·`submitDecision`·Manager `pendingByProject` 변경 0** — choice는 pass-through, risk_classification DecisionRequest는 기존 `pendingByProject`가 그대로 조회(type 무관).

## 각 단위 계약

- **`buildRiskBrief(input): DecisionRequestInput`**: 순수. `input={workflowId, version, classification: RiskClassification}`(classification에서 projectId·risk·dimensionScores·humanGate·complianceFrameworks 추출). context: `location='리스크 분류 (v{version})'`·`expectedVsActual='risk={risk}. {humanGate.reason}. 승인하면 라우팅 확정+wp.risk 반영, 거부하면 재분류.'`·`impact=[차원별 score 요약]`·`evidenceRefs=[complianceFrameworks]`·`options=['approve','reject']`. requestId=`{workflowId}:risk:{version}`(결정론·재채점 version++=새 요청).
- **producer emit**: best-effort(never-throw·이미 risk-producer의 try/catch 안)·`decisionStore` 미주입이면 skip·flag off면 skip. 멱등(같은 version은 ON CONFLICT DO NOTHING).
- **consumer approve 분기**: `riskStore.approve`는 P2r-2 `RiskClassificationRepo.approve(workflowId, approvedBy)` 재사용(pending만·이미 승인이면 null). decidedBy를 approvedBy로 전달(실 비부인). never-throw(상위 try/catch).
- **DecisionsPanel**: `options = d.context?.options?.length ? d.context.options : DEFAULT_CHOICES`. 각 option을 버튼으로(라벨 `decisions.choice_{option}`·미지 키는 option 문자열 fallback). submit은 기존 `submitDecision(serverUrl, projectId, requestId, choice)` 그대로.

## flag · 전제

- **`MANAGER_RISK_DECISION`**(기본 false·`v === 'true'`). 전제: `MANAGER_RISK_CLASSIFY`(분류 생성)+`MANAGER_DECISION_ROUTING`(decision-consumer 가동)+`DATABASE_URL`. 실효성엔 `MANAGER_RISK_ROUTING`(승인→write-back). off → 회귀 0.
- **새 migration 없음**(`011 decision_requests`·`012 risk_classifications` 재사용).
- **OutboxRelay**: 이미 `MANAGER_DECISION_ROUTING`/`MANAGER_RISK_ROUTING`로 가동(decision.recorded·risk.approved 발행) — 조건 미변경.

## 검증 (TDD)

- **`buildRiskBrief`(순수·unit)**: 매핑 정확성·requestId 멱등·options=['approve','reject'].
- **producer emit(unit)**: humanGate.required면 createRequest 호출·미required면 미호출·decisionStore 미주입 skip·never-throw.
- **decision-consumer approve(unit)**: approve+risk_classification+riskStore → `riskStore.approve(workflowId, decidedBy)` 1회·다른 type/choice no-op·never-throw.
- **decision.route(route test)**: choice `approve` 수용(기존 4 choice 회귀 0).
- **DecisionsPanel(browser test)**: `context.options` 렌더(`['approve','reject']` 버튼)·options 없으면 기존 4 fallback·stale 블랭킷 라벨 부재.
- **i18n**: `node scripts/check-i18n.js` ko/en/ja 동기화.
- **E2E DB 통합(skip-if-no-DB·`wf-c5-` prefix)**: classify(HIGH)→producer createRequest→`pendingByProject`가 risk_classification 반환→recordDecision(approve)→decision-consumer가 `RiskClassificationRepo.approve` 호출→risk.approved→(updateWpRisks)→wp.risk=HIGH 검증.

## 수용 기준

1. `MANAGER_RISK_DECISION` off → 기존 흐름 바이트 회귀 0(DecisionsPanel context.options 리팩터는 기존 defect_brief 카드 렌더 불변).
2. on + HIGH 분류 생성 → `risk_classification` DecisionRequest가 C1 대기함에 등장(options approve/reject).
3. 사람 승인 → decidedBy=인증 JWT subject로 `RiskClassificationRepo.approve` → risk.approved → wp.risk 반영(P2r-4와 연결 시 mutation 발화).
4. DecisionsPanel이 stale "기록만" 블랭킷 라벨 없이 정직하게 렌더(부채 해소).
5. 멱등: 같은 분류(version) 재발행은 중복 DecisionRequest 미생성.

## 비범위 (후속 — 명시)

- **디스패치 게이팅**(INTAKE→DECOMPOSING — 리스크 승인 전 디스패치 차단).
- **리스크 특화 리치 뷰**(차원 점수·모델 라우팅 카드 — 현재는 표준 DecisionContext 텍스트 요약).
- **reject → 재분류 실동작**(현재 reject는 결정 영속만·재분류 트리거 없음).
- **D5 모델 라우팅 소비** · **P7 per-WP 재채점**.
- **per-type 정확 liveness 라벨**(어느 choice가 즉시 동작하는지 backend-driven 표기 — 현재는 stale 블랭킷 제거 + 일반 hint로 정직화, 정밀 표기는 후속).
