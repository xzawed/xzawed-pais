# P5-2a 릴리스 게이트 사인오프 — 설계 (gate.blocked → 사인오프)

> 날짜: 2026-06-20 · Phase 5 둘째 슬라이스 · 원천 사양: `docs/senario/OPERATIONS_DECISIONS.md` §1 · `docs/senario/HUMAN_DECISION_PERSISTENCE.md` §3-6 · P5-1 스펙 `docs/superpowers/specs/2026-06-14-p5-1-release-gate-core-design.md` §2(P5-2 비목표)
> 불변식: M9(사인오프 비부인·불변 영속) · M8(무음 차단 금지 — 차단된 게이트가 사람에게 도달) · M5/M7(트랜잭셔널 아웃박스·인과) · N3(best-effort never-throw)
> 전제 머지: #302(P5-1 릴리스 게이트 코어) · #299(P6 결정 라우팅) · #303/#306(C0/C1 결정 UI)

## 1. 목표

P5-1(#302)이 발행하는 `gate.blocked` 이벤트는 현재 **소비자가 없다**(고아 스트림 `manager:release:main`). 즉 릴리스 게이트가 차단돼도 그 사실이 사람에게 도달하지 않는다(M8 위반 잠재). P5-2a는 `gate.blocked`를 **사람 사인오프 DecisionRequest로 라우팅**해, 방금 완성된 C1 결정 대기함(#306)이 그 사인오프를 surface하게 한다. 사람이 `accept_known`(위험 수용 사인오프)을 제출하면 휴면하던 `DecisionRepo.recordSignOff`가 처음 호출돼 **비부인 사인오프**(M9)가 영속된다.

핵심 설계 원칙: **C1 UI 재사용 0 변경.** `gate.blocked`의 `ReleaseGateResult`를 **표준 `DecisionContext`**(location·expectedVsActual·impact·evidenceRefs·options)로 매핑하면, C1 카드가 이미 그 형태를 렌더하므로 Orchestrator 변경이 전혀 없다. P5-2a는 **단일 Manager 슬라이스**다.

## 2. 비목표 (범위 밖 · 후속 슬라이스)

- **P5-2b**: `gate.passed`를 `deploy_project` 실행의 hard 전제로 연동(deploy 게이팅) · 사인오프 후 실제 promote/deploy 소비.
- **C1 UI 정제**: decision type별 choice 필터(`degraded_release`는 `accept_known`/`reject`만)·degraded_release 전용 카드. 현재는 표준 context 매핑으로 기존 카드가 surface(4 choice 표시·`fix_reverify`/`spec_fix`는 wpId=null 가드로 graceful no-op).
- **reject → saga 롤백**(P5-4) · **워크플로 RELEASING/MONITORING FSM**(P5-3/WORKFLOW.md) · **강등 FSM N2**(P5-3).
- accept_known 사인오프가 만드는 `gate_override` 사인오프 레코드의 **소비**(deploy 게이팅이 읽음)는 P5-2b.

## 3. 배경 — 현재 상태

- **게이트 발행(P5-1·`db/release-gate.repo.ts`)**: all-WP-done 시 `completion.ts`→`evaluateReleaseGate`→`recordGate`가 `gate.blocked`를 `manager:release:main`에 발행. 페이로드 = `{ workflowId, gateVersion, status:'blocked', perWp: WpGateView[], blockingReasons: string[] }`. **소비자 0.**
- **결정 영속·라우팅(#299·`db/decision.*`·`streams/decision-consumer.ts`)**: `DecisionRepo.createRequest`(가변 프로젝션 PENDING)·`recordDecision`(→RESOLVED + `decision.recorded` 이벤트·페이로드 `{decisionId, requestId, choice, routedTo, decidedBy}`)·`recordSignOff`(**호출자 0·휴면**). `DecisionRecordedConsumer`가 `decision.recorded`를 소비해 현재 **`fix_reverify`만** 실동작(`req.wpId` 가드로 release-level 결정은 자동 no-op).
- **C1 결정 대기함(#306)**: `pendingByProject(projectId)`로 프로젝트 pending 결정을 조회·카드 렌더(`context.location`·`expectedVsActual`·`impact[]`·`evidenceRefs[]`·`attribution`)·4 choice 제출(`decidedBy`는 인증 JWT subject).
- **결정 타입/사인오프 스키마**: `DecisionRequest.type` enum에 `degraded_release` 존재. `HumanDecision.choice` enum에 `accept_known`·`routedTo` enum에 `gate_override` 존재. `recordSignOff({signoffId, decisionId, scope, approver, risk, reason?, ...})` 존재(migration 011·휴면).

## 4. 아키텍처 & 데이터 흐름

```
[기존 P5-1]
all-WP-done → evaluateReleaseGate(blocked) → recordGate
   → gate.blocked (manager:release:main · {workflowId, gateVersion, status, perWp, blockingReasons})

[신규 P5-2a — gate.blocked → DecisionRequest]
ReleaseSignoffConsumer(BaseConsumer·dedup) → buildSignoffBrief(payload → degraded_release DecisionRequestInput)
   → graphStore.getGraph(wf).userContext?.projectId  (C0 패턴·never-throw N3)
   → DecisionRepo.createRequest(degraded_release · project_id 영속)
   → C1 pendingByProject가 surface (Orchestrator 변경 0)

[사람 결정 — 기존 C1 UI + #299 라우팅 확장]
accept_known 제출 → decision.recorded → DecisionRecordedConsumer(확장)
   → choice==='accept_known' && req.type==='degraded_release'
   → DecisionRepo.recordSignOff(decisionId·scope='release'·approver=decidedBy·risk·routedTo gate_override)
   → signoff.recorded (단일 tx 아웃박스 M5/M7/M9)
   reject = 기록만(block 유지·saga P5-4) / fix_reverify·spec_fix = req.wpId=null 가드로 graceful no-op
```

`MANAGER_RELEASE_SIGNOFF`(기본 false) flag 뒤로 가역 — off면 게이트 발행 흐름 P5-1과 바이트 동일·회귀 0. 전제: `MANAGER_RELEASE_GATE`(gate.blocked 발행)+`MANAGER_DECISION_ROUTING`(decision.recorded 소비)+`DATABASE_URL`.

## 5. 컴포넌트 (전부 Manager·additive)

### 5.1 `streams/signoff-brief.ts` (순수)
- `SignoffBriefInfo`(`{workflowId, gateVersion, blockingReasons: string[], perWp: WpGateView[]}`) · `buildSignoffBrief(info, projectId?): DecisionRequestInput`:
  - `requestId = ${workflowId}:gate:${gateVersion}` (결정론 멱등 — 같은 게이트 버전 재발행도 `createRequest` ON CONFLICT DO NOTHING).
  - `type:'degraded_release'` · `workflowId` · `correlationId:workflowId` · `wpId:null`(release-level) · `severity:'blocking'` · `projectId`.
  - `context`: `location = '릴리스 게이트 (gate ${gateVersion})'` · `expectedVsActual = '${unproven}개 WP 미증명 — 릴리스 게이트 차단'`(unproven=`perWp.filter(w => !w.proven).length`) · `impact = blockingReasons` · `evidenceRefs = perWp.filter(!proven).map(w => w.wpId)` · `options:['accept_known','reject']`.
  - **표준 DecisionContext 형태라 C1 카드가 그대로 렌더**(C0 `buildDefectBrief`와 동일 계약).
- `makeSignoffBrief(store, graphStore?)` — `gate.blocked` 핸들러 팩토리(`makeEscalationBrief` 패턴): payload→projectId 조회(graphStore, never-throw null)→buildSignoffBrief→`store.createRequest`. throw 가드는 소비자가 best-effort로 감쌈.

### 5.2 `streams/release-consumer.ts`
- `GateBlockedSchema`(envelope+`type`+payload `{workflowId, gateVersion, blockingReasons, perWp}`·느슨 — 비-blocked gate.* 통과) · `buildGateBlockedHandler(deps)` — `type==='gate.blocked'`만 처리(`gate.passed`는 무시·P5-2b)→`makeSignoffBrief`. never-throw.
- `ReleaseSignoffConsumer extends BaseConsumer`(group `manager-release-consumers`·prefix `manager:release`·dedup ON)·`start('main')`→`manager:release:main`. `DecisionRecordedConsumer`·`OracleApprovedConsumer` 패턴 미러.

### 5.3 `streams/decision-consumer.ts` 확장
- `RecordedPayloadSchema`에 `decisionId`·`decidedBy` 추가(decision.recorded 페이로드에 이미 존재·#299는 미사용).
- `DecisionRoutingDeps`에 `signoffStore?: { recordSignOff(...): Promise<{eventId}|null> }` additive.
- `buildDecisionRecordedHandler`: choice 게이트를 확장 — `fix_reverify`(기존 reopenLease 경로) **또는** `accept_known`. `accept_known`이면 `getRequest`→`req.type==='degraded_release'` && `signoffStore` 있으면 `recordSignOff({signoffId:${decisionId}:signoff, decisionId, scope:'release', approver:decidedBy, risk:'HIGH', reason:'릴리스 게이트 차단 사인오프'})`. (`gate_override` 라우팅은 `recordSignOff` 인자가 아니라 이미 `HumanDecision.routedTo`에 `CHOICE_TO_ROUTED[accept_known]='gate_override'`로 영속됨 — #299.) 그 외 choice·type 불일치·signoffStore 미주입은 no-op. never-throw 보존.

### 5.4 배선 (`streams/supervisor.ts`·`server.ts`)
- `SupervisorConfig.releaseSignoff?`(=`MANAGER_RELEASE_SIGNOFF`). `createSupervisor`가 `releaseSignoff`+`decisionStore`+`releaseStore`(graphStore=repo)면 `ReleaseSignoffConsumer` 조건부 배선 + `DecisionRecordedConsumer` deps에 `signoffStore`(DecisionRepo) 합류.
- `server.ts`: `MANAGER_RELEASE_SIGNOFF`+pool이면 배선 + 오진 경고(전제 RELEASE_GATE·DECISION_ROUTING off). `manager:release:main`은 이미 P5-1 OutboxRelay가 발행(소비자만 신규).

## 6. project_id 스레딩

C0의 `GraphQueryPort`(`getGraph(wf)→{userContext:{projectId}|null}|null`) 재사용 — `makeSignoffBrief`가 graphStore로 projectId 조회(never-throw N3·legacy null). `DecisionRequest.project_id`로 영속(C1 `pendingByProject`가 surface). projectId null이면 프로젝트 패널 미표시(graceful degradation — C0와 동일).

## 7. 사인오프 산출 (M9)

`recordSignOff`: `signoffId=${decisionId}:signoff`(결정론 멱등 M6)·`decisionId`(참조 결정·causation)·`scope='release'`·`approver=decidedBy`(인증 사용자 신원)·`risk='HIGH'`. `sign_offs` 불변 append-only + `signoff.recorded` 이벤트 단일 tx 아웃박스(M5/M7). 결정 자체는 `HumanDecision.routedTo='gate_override'`로 이미 영속(#299 `CHOICE_TO_ROUTED`). **비부인**: 누가 차단된 릴리스를 수용했는지 불변 기록. **`scope='release'` 사인오프 레코드가 P5-2b deploy 게이팅의 진실원천**(이 슬라이스는 기록만).

## 8. 테스트 전략 (회귀 0 — flag off면 바이트 동일)

- `buildSignoffBrief` unit: ReleaseGateResult→degraded_release 매핑·requestId 멱등·context 형태(impact=blockingReasons·evidenceRefs=un-proven WPs).
- `release-consumer` unit: gate.blocked 소비→createRequest(degraded_release·projectId)·gate.passed 무시·graphStore null/throw→projectId null(never-throw).
- `decision-consumer` unit: accept_known+degraded_release→recordSignOff(scope/approver/decisionId)·accept_known+다른 type→no-op·fix_reverify on degraded_release(wpId=null)→no-op·signoffStore 미주입→no-op.
- DB 통합(skip-if-no-DB·prefix `wf-rs-`): gate.blocked→createRequest→recordDecision(accept_known)→recordSignOff→`sign_offs` 행·signoff.recorded 이벤트 루프 실증.

## 9. 불변식 매핑

| 불변식 | 충족 |
|---|---|
| **M8** 무음 차단 금지 | gate.blocked가 사람 사인오프 DecisionRequest로 도달(고아 스트림 소비) |
| **M9** 비부인 | `recordSignOff` 불변 append-only·approver=인증 신원·signoff.recorded 진실원천 |
| **M5/M7** 트랜잭셔널 아웃박스·인과 | recordSignOff 단일 tx(sign_offs+events+outbox)·causation=decisionId |
| **N3** never-throw | release-consumer·graphStore lookup·decision-consumer 라우팅 전부 best-effort |
| **M6** 멱등 | requestId(`{wf}:gate:{version}`)·signoffId(`{decisionId}:signoff`) ON CONFLICT DO NOTHING |
| **N4** 식별자 안정 | requestId는 (wf,gateVersion) 결정론·project_id는 컬럼 |

## 10. 슬라이스 경계

**단일 PR** `feat/manager/p5-2a-gate-blocked-signoff`: signoff-brief·release-consumer·decision-consumer 확장·supervisor/server 배선·flag·DB 통합 테스트. C0 graphStore·#291 brief·#299 routing·#302 게이트 패턴 재사용. **C1(Orchestrator) 변경 0**(표준 context 매핑으로 surface). off면 회귀 0.
