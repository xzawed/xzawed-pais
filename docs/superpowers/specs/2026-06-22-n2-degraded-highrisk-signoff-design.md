# N2 — DEGRADED HIGH-risk 디스패치 사인오프

**날짜**: 2026-06-22
**상태**: 설계 승인됨(브레인스토밍 → 본 스펙)
**원천 스펙**: `docs/senario/OPERATIONS_DECISIONS.md` §1(강등 모드)·N2(DEGRADED HIGH-risk 사인오프) · HUMAN_DECISION_PERSISTENCE.md §3(사인오프 비부인)
**선행 슬라이스**: P5-3a 강등 모드 FSM(#327) · P5-3b SAFE 디스패치 보류+복구 재개(#329) · P5-2a 사인오프(#308) · P6 결정 라우팅(#299)

## 배경

P5-3b(#329)는 운영 모드 **SAFE**에서 신규 디스패치를 일괄 보류한다(mode-level·all-or-nothing). P5-3 enforcement의 두 번째 동작은 **DEGRADED HIGH-risk 사인오프(N2)**다: 운영 모드가 **DEGRADED**일 때 **HIGH-risk WP**는 자동 디스패치하지 않고 사람 사인오프를 받는다(per-WP·risk-conditional). 현재 DEGRADED 신호원은 provider 서킷 open(지속 장애) 단일 — 그 상태에서 HIGH-risk WP를 디스패치하면 워커의 provider 호출이 fail-fast로 실패하고 lease reclaim 사이클을 낭비한다. N2는 이를 즉시 사람 결정(accept_known/reject)으로 라우팅해, 위험한 작업을 강등 운영 중에 자동 진행하지 않는 거버넌스 게이트를 만든다.

## 범위 결정 (브레인스토밍 확정)

- **DEGRADED + HIGH-risk만 게이팅**: LOW/MED·NORMAL/SAFE는 무관(SAFE 보류는 P5-3b). per-WP — 한 워크플로 안에서 HIGH-risk WP만 보류하고 나머지는 정상 디스패치.
- **승인 후 재디스패치 = 내구적 승인조회 + handleDispatch 재트리거**(브레인스토밍 확정): 사인오프를 `sign_offs`(append-only·비부인·재시작 생존)에 영속하고, decision-consumer가 `redispatch(wf)` 콜백으로 `handleDispatch`를 재실행한다. 게이트가 `hasApprovedDegradedDispatch(wf, wpId)` DB 조회로 승인 WP만 통과(P5-2b `hasApprovedReleaseSignoff` 패턴). **단일 디스패치 경로 유지**(소비자가 dispatch 오케스트레이션 중복 안 함).
- **reject = no-op**: WP 보류 유지·DecisionRequest RESOLVED(재프롬프트 없음). governance "진행 안 함"(#299 reject 매핑-only 선례). 만료는 B1 TTL/재에스컬이 자동 처리.
- **신규 flag** `MANAGER_DEGRADED_SIGNOFF`(기본 false·전제 `MANAGER_DEGRADED_ENFORCE`+`MANAGER_DECISION_ROUTING`+`DATABASE_URL`). off→P5-3b와 바이트 동일(회귀 0).
- **재사용**: P5-3b 디스패치 chokepoint(`getMode`)·P5-2a 사인오프 브리프/`recordSignOff`·decision-consumer 라우팅·P5-2b 승인조회 join.
- **migration 0**: `decision_requests.type`은 TEXT(011) — `degraded_dispatch` 타입 추가는 Zod enum 확장만(C5 `risk_classification` 선례). choice는 기존 `accept_known`/`reject` 재사용(신규 0). 이벤트 스트림 0·shared 변경 0.

## 아키텍처

```
handleDispatch(workflowId, deps) [DEGRADED]:
  plan의 ready WP 루프 — wpById로 wp.risk 조회:
    degradedSignoffActive && getMode()==='DEGRADED' && wp.risk==='HIGH':
      approved = await isHighRiskDispatchApproved(wf, wpId)
      !approved → await onDegradedHighRisk({wf, wpId, stepN, projectId}) (멱등 createRequest) + skip(보류·미디스패치)
      approved  → 정상 recordDispatch (fall through)
    else → 정상 recordDispatch

사람 accept_known (degraded_dispatch DecisionRequest):
  decision-consumer → recordSignOff(scope='degraded_dispatch'·risk HIGH·비부인 M9)
                   → redispatch(wf) → handleDispatch 재실행
                   → 그 WP는 isHighRiskDispatchApproved=true → recordDispatch → 워커 트리거

사람 reject → DecisionRequest RESOLVED·WP 보류 유지(no-op)
```

- **단일 chokepoint**: DEGRADED 게이트는 `handleDispatch`의 디스패치 루프 안(decomposition·completion·oracle 세 경로가 공유하는 dispatch 객체) → 한 곳 주입으로 전 경로 커버. SAFE(P5-3b)는 함수 진입부 early-return(all-or-nothing), DEGRADED(N2)는 루프 안 per-WP — 같은 `getMode` 다른 granularity.
- **재디스패치 멱등**: 승인 후 handleDispatch 재실행 시 승인 WP만 통과·이미 DISPATCHED면 `alreadyDispatched`로 제외. 여러 번 재트리거돼도 안전.

## 각 단위 계약 (전부 additive)

### 1. `db/decision.types.ts` — `degraded_dispatch` 타입
- `DecisionRequestSchema.type` z.enum에 `'degraded_dispatch'` 추가. **migration 0**(type 컬럼 TEXT). `HumanDecisionSchema.choice`·`SignOffSchema`는 무변경(accept_known/reject·scope 자유 string 재사용).

### 2. `streams/degraded-signoff-brief.ts` (신규)
- `DegradedDispatchInfo { workflowId; wpId; stepN: number; projectId?: string | null }`.
- `buildDegradedDispatchBrief(info): DecisionRequestInput` — `requestId: '{wf}:degraded:{wpId}'`(결정론 멱등)·`type: 'degraded_dispatch'`·`wpId`·`severity: 'blocking'`·`projectId`·`context`(location=`WP {wpId} (HIGH-risk·운영 강등 모드)`·expectedVsActual=강등 중 HIGH-risk 보류 설명·impact·evidenceRefs=[`wp.held@{wf}/{wpId}`, `risk=HIGH`, `mode=DEGRADED`]·`options: ['accept_known','reject']`). 표준 DecisionContext라 C1 카드 그대로 렌더.
- `makeDegradedDispatchBrief(store: DecisionBriefStore, opts?): (info) => Promise<void>` — `expiresAtFrom`(B1 TTL) 병합 후 `createRequest`(멱등 ON CONFLICT). `makeSignoffBrief` 미러.

### 3. `db/decision.repo.ts` — `hasApprovedDegradedDispatch` (읽기 신규)
- `async hasApprovedDegradedDispatch(workflowId: string, wpId: string): Promise<boolean>`:
  ```sql
  SELECT 1 AS ok
    FROM sign_offs s
    JOIN human_decisions h ON h.decision_id = s.decision_id
    JOIN decision_requests r ON r.request_id = h.request_id
   WHERE r.workflow_id = $1 AND r.wp_id = $2 AND r.type = 'degraded_dispatch' AND s.scope = 'degraded_dispatch'
   LIMIT 1
  ```
  `rows.length > 0`. `hasApprovedReleaseSignoff` 패턴 + wp_id·type 필터.

### 4. `streams/dispatch.ts` — DEGRADED HIGH-risk 게이트
- `DispatchDeps`에 additive optional 2개:
  - `isHighRiskDispatchApproved?: (workflowId: string, wpId: string) => Promise<boolean>`.
  - `onDegradedHighRisk?: (info: { workflowId: string; wpId: string; stepN: number; projectId: string | null }) => Promise<void>`.
- `handleDispatch` 디스패치 루프: `const degradedSignoffActive = deps.onDegradedHighRisk !== undefined && deps.isHighRiskDispatchApproved !== undefined`. 루프 진입부에서 `wpById = new Map(stored.workPackages.map(w => [w.id, w]))`. 각 item:
  ```ts
  const wp = wpById.get(item.wpId)
  if (degradedSignoffActive && deps.getMode?.() === 'DEGRADED' && wp?.risk === 'HIGH') {
    const approved = await deps.isHighRiskDispatchApproved!(workflowId, item.wpId)
    if (!approved) {
      await deps.onDegradedHighRisk!({ workflowId, wpId: item.wpId, stepN: item.stepN, projectId: stored.userContext?.projectId ?? null })
      continue // 보류 — recordDispatch·publish 미실행
    }
  }
  // ... 기존 recordDispatch
  ```
- 미주입(flag off)→`degradedSignoffActive=false`→루프 분기 미실행→기존 동작 바이트 동일(회귀 0). held WP는 `dispatched`에 미포함·상태 전이 0(DRAFTED 유지). `DispatchOutcome` 인터페이스 무변경(held는 dispatched 부재로 관측·skipped 미가산).

### 5. `streams/decision-consumer.ts` — accept_known 확장
- `DecisionRoutingDeps`에 `redispatch?: (workflowId: string) => Promise<void>` additive.
- `accept_known` 분기 확장: `req.type === 'degraded_release'`(기존 P5-2a) 외에 `req.type === 'degraded_dispatch'` 처리 추가 — `signoffStore.recordSignOff({ signoffId: '{decisionId}:signoff', decisionId, scope: 'degraded_dispatch', approver: decidedBy, risk: 'HIGH', reason: '강등 모드 HIGH-risk 디스패치 사인오프' })` + `await deps.redispatch?.(req.workflowId)`. never-throw 유지(기존 try/catch). 분기 구조 정리(타입별 scope·redispatch 매핑).

### 6. `config.ts`·`supervisor.ts`·`server.ts` — 배선
- `config.ts`: `MANAGER_DEGRADED_SIGNOFF`(z `.string().optional().transform(v => v === 'true')`·기본 false).
- `supervisor.ts`: `SupervisorConfig.degradedSignoff?`·`SupervisorDeps`에 N2 deps 추가(decisionStore는 이미 존재). `createSupervisor`:
  - `degradedSignoffActive = config.degradedSignoff === true && deps.decisionStore != null`(행동 단언).
  - **`baseDispatch`에** `...(degradedSignoffActive && { isHighRiskDispatchApproved: (wf, wpId) => deps.decisionStore!.hasApprovedDegradedDispatch(wf, wpId), onDegradedHighRisk: makeDegradedDispatchBrief(deps.decisionStore!, briefOpts) })` 추가 — `buildDispatchGate(baseDispatch, deps.getMode)`가 `...base`로 N2 콜백을 보존하면서 getMode/onHeld를 합류시키므로 결과 `dispatch`가 SAFE 게이트(P5-3b)+DEGRADED 게이트(N2)를 모두 보유. getMode는 P5-3b(enforce) 주입을 전제(아래 flag 전제·미주입 시 DEGRADED 분기 미발화).
  - `DecisionRecordedConsumer` deps에 `...(degradedSignoffActive && { redispatch: (wf) => handleDispatch(wf, dispatch) })`(oracle-consumer가 dispatch 받는 패턴). signoffStore는 이미 P5-2a 경로로 주입됨(`config.releaseSignoff && decisionStore`) — N2는 degraded_dispatch에도 signoffStore 필요하므로 주입 조건을 `(releaseSignoff || degradedSignoff)`로 확장.
  - `decisionStore.hasApprovedDegradedDispatch` 메서드를 `SupervisorDeps.decisionStore` 인터섹션에 추가.
- `server.ts`: `MANAGER_DEGRADED_SIGNOFF` 전달·전제 경고(ENFORCE off→getMode 미주입으로 게이트 무력·DECISION_ROUTING off→소비자/사인오프 미배선·pool 부재). decisionStore는 이미 BRIEF/ROUTING/SIGNOFF면 생성됨 — 조건에 DEGRADED_SIGNOFF 추가.

## flag · 전제

- **`MANAGER_DEGRADED_SIGNOFF`**(기본 false): on(+`MANAGER_DEGRADED_ENFORCE`(getMode 원천)+`MANAGER_DECISION_ROUTING`(decision-consumer·redispatch·signoff)+`DATABASE_URL`(DecisionRepo))이면 DEGRADED HIGH-risk 디스패치 사인오프 enforcement. off→P5-3b와 바이트 동일(회귀 0).
- **migration 0·이벤트 스트림 0·shared 변경 0**. 신규 env 1.

## 검증 (TDD)

- **`buildDegradedDispatchBrief`(unit·순수)**: requestId `{wf}:degraded:{wpId}`·type `degraded_dispatch`·wpId·options `['accept_known','reject']`·projectId 전파.
- **`dispatch.ts`(unit·mock)**: getMode DEGRADED + HIGH-risk + 미승인 → onDegradedHighRisk 호출·recordDispatch 미호출·dispatched 미포함; 승인됨 → 정상 디스패치; LOW/MED → 정상 디스패치(게이트 무관); NORMAL → 정상 디스패치; 콜백 미주입(degradedSignoffActive=false) → 기존 동작 바이트 동일(회귀 0); SAFE early-return이 DEGRADED 루프보다 우선.
- **`hasApprovedDegradedDispatch`(DB 통합)**: 미승인 false·accept_known+signoff 후 true·다른 wpId/타입 격리.
- **`decision-consumer.ts`(unit·mock)**: accept_known + degraded_dispatch → recordSignOff(scope='degraded_dispatch') + redispatch(wf) 호출; degraded_release는 기존 동작 보존(scope='release'·redispatch 미호출); reject → no-op; redispatch 미주입 → recordSignOff만(no-throw).
- **`supervisor.ts`(unit)**: degradedSignoff+decisionStore → dispatch deps에 isHighRiskDispatchApproved/onDegradedHighRisk·consumer에 redispatch 주입; 미주입 → 부재(회귀 0).
- **배선(unit)**: `MANAGER_DEGRADED_SIGNOFF` flag 파싱(기본 false).
- **DB 통합(`test/degraded-signoff.integration.test.ts`, skip-if-no-DB·`wf-ds-` prefix)**: DEGRADED+HIGH-risk handleDispatch → held(디스패치 0·DecisionRequest 생성) → accept_known recordSignOff → hasApprovedDegradedDispatch=true → 재 handleDispatch → DISPATCHED 전이(보류→사인오프→디스패치 폐루프).
- **회귀**: 전체 Manager 스위트 그린(flag off 바이트 동일).

## 수용 기준

1. `MANAGER_DEGRADED_SIGNOFF` off → N2 deps 미주입·동작 바이트 동일(회귀 0).
2. on + DEGRADED + HIGH-risk WP 미승인 → 디스패치 보류(미디스패치·전이 0) + `degraded_dispatch` DecisionRequest 생성(멱등).
3. on + DEGRADED + LOW/MED WP → 정상 디스패치(HIGH-risk만 게이팅).
4. 사람 accept_known → recordSignOff(scope='degraded_dispatch'·비부인) + redispatch → 그 WP DISPATCHED.
5. 사람 reject → WP 보류 유지(no-op)·재프롬프트 없음.
6. 승인 내구성: sign_offs append-only라 재시작 후 재디스패치도 승인 WP 통과·멱등.

## 비범위 (후속 — 명시)

- **reject 능동 처리**(escalate/saga 롤백)·**DEGRADED 추가 신호원**(브로커·Supervisor 하트비트·per-workflow budget)·**사인오프 만료/철회 정책**·**HIGH 외 등급 게이팅**(θ 기반).
- per-WP 사인오프 UI 별도 surface(현재 C1 결정 대기함 카드 재사용)·다중 워크플로 배치 사인오프.
