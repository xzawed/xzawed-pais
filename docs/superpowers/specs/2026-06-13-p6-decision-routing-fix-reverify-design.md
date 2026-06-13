# P6 사람 결정 라우팅 — fix_reverify 폐루프 — 설계

- 날짜: 2026-06-13
- 상태: 설계 승인됨
- 선행: P6 M9 의사결정 영속(#288)·결함 브리프(#291)·P4 4c 귀속 라벨(#298)·P1d-5 lease/escalation
- 사양 출처: `docs/senario/HUMAN_DECISION_PERSISTENCE.md` §4(결정→다운스트림 라우팅)·`docs/senario/xzawedPAIS_handoff_spec.md` §11·§15·N5 (충돌 시 사양 우선)
- 영향 서비스: **xzawedManager** (decision-consumer·decision.route·lease.repo·supervisor·config)

## 1. 배경·동기

### 1.1 현재: 결정이 dead-end
P6 M9(#288)는 `DecisionRepo`로 사람 결정을 event-sourced 영속하고, #291은 lease 상한 초과 escalation을 `defect_brief` DecisionRequest로 만든다(#298 4c가 §11 귀속 라벨 추가). 그러나:
- `recordDecision`은 `decision.recorded`(payload `{decisionId, requestId, choice, routedTo, decidedBy}`)를 `manager:decision:main` outbox에 발행하지만 **소비자가 0건**(dead-end).
- 결정을 제출할 **HTTP 라우트가 없다**(사람이 결정을 낼 입구 부재).
- **ESCALATED가 종단 상태**: escalated WP는 `readyNodes`에서 제외(alreadyDispatched=DISPATCHED∪ESCALATED, P1d-6)되어 재진입 경로가 없다.

### 1.2 §11/§15 되먹임 (HUMAN_DECISION_PERSISTENCE.md §4)
| choice | 다운스트림 |
|---|---|
| fix_reverify | 구현 계층 재진입(EXECUTING) |
| spec_fix | 기획/Task 재진입(오라클 정련) |
| accept_known | SignOff + 기술부채, 게이트 통과 허용 |
| reject | saga 보상 롤백 |

### 1.3 구조적 제약 (탐색 발견)
- **spec_fix(재분해=P2)·reject(saga 보상=P5)·accept_known(게이트 통과 unblock)은 미구현 인프라 의존**.
- **fix_reverify(구현 재진입)는 자족적**: escalated WP의 lease를 재오픈(active)하고 `dispatch_signal`을 재발행하면 워커(P4-1)가 재실행 → ESCALATED 종단을 깨는 첫 폐루프.

따라서 이 슬라이스는 **fix_reverify 폐루프**에 집중하고, 다른 choice는 소비자가 인지·로깅하되 실동작은 후속.

## 2. 불변식 (반드시 충족)

| ID | 불변식 | 적용 |
|---|---|---|
| §11/§15 | 사람 결정이 올바른 계층으로 되먹임 | fix_reverify→구현 재진입(lease 재오픈→dispatch_signal). |
| M9 | 사람 결정은 권위 기록·비부인 | 결정 제출은 `recordDecision`(append-only HumanDecision·outbox) 경유. |
| M2 | 사람이 권위 | 자동 재진입 없음 — 사람이 fix_reverify를 명시 제출해야 재진입. |
| N5 | 무한 루프 차단 | 재진입은 사람 게이트가 매번 차단(자동 아님). 진동 임계 자동 승급은 4c/후속. |
| — | flag-off 회귀 0 | `MANAGER_DECISION_ROUTING` off면 소비자·라우트 미배선(#291 브리프 생성만). |
| — | never-throw·멱등 | 소비자 best-effort·dedup ON. reopenLease는 escalated→active 단방향 가드(0행 skip). |
| M3 | 직접 import 0 | 소비자는 Redis 스트림(`manager:decision:main`)만 소비·DispatchDeps 주입. |

## 3. 설계 결정

### D1. flag 분리 — `MANAGER_DECISION_ROUTING` 신규
브리프 생성(#291 `MANAGER_DECISION_BRIEF`=관측)과 라우팅(P6=동작)을 분리한다. 라우팅 flag off면 브리프만 생성(현재 동작·회귀 0). on이면 소비자+라우트 배선으로 폐루프. 점진 배선·관측↔동작 분리.

### D2. attempt **advance**(현재+1) on 재진입
escalated WP 재오픈 시 `attempt`를 **advance**(현재+1) — 사람 승인이 reopen당 **재시도 1회**를 부여. ⚠️ attempt 0 리셋 금지: `dispatch_signal` 멱등키가 attempt를 포함하므로 0 리셋은 원래 dispatch(attempt 0)와 키 충돌→워커 dedup(24h)이 재디스패치 신호를 드롭(WP 미재실행). reclaim과 동일하게 attempt+1로 advance해 키 고유성을 확보한다. stepN은 실제 lease `step_n` 사용(표시용 0 하드코드 제거), causationId(=requestId)를 wpEnvelope에 스레딩(M7 provenance). 무한 루프는 사람 게이트(매 escalation마다 새 결정 필요)가 차단 — 자동 재시도가 아니다(N5). 한계: "새 재시도 풀(0 리셋)" 대신 reopen당 1회 재시도(attempt+1)·반복은 사람 게이트가 차단(N5).

### D3. 다른 choice = no-op + 로깅 (에러 아님)
소비자는 `fix_reverify`만 실동작. `spec_fix`/`reject`/`accept_known`은 `app.log.info`로 "후속 미구현" 기록 후 no-op. 폐루프를 막지 않고(구조적 보장), 후속 슬라이스가 실동작 추가. 알 수 없는 choice도 동일(never-throw).

### D4. 재진입 메커니즘 = lease 재오픈 (handleDispatch 아님)
`handleDispatch`는 `readyNodes`(escalated 제외)를 디스패치하므로 특정 escalated WP 재진입에 부적합. 대신 `LeaseStore.reopenLease(wf, wpId)`가 escalated lease를 active로 되돌리고 `dispatch_signal`을 재발행 → 워커가 그 WP를 재실행. wpId는 소비자가 `getRequest(requestId).wpId`로 조회(payload에 wpId 없음·requestId 파싱보다 견고).

## 4. 구현 (파일별)

### 4.1 `db/lease.repo.ts` — `reopenLease`
```typescript
async reopenLease(input: { workflowId; wpId; visibilityMs; causationId? }): Promise<{ status:'reopened'; eventId; seq; attempt } | { status:'skipped' }>
```
①`getLease(wf, wpId)` 선조회 — null이거나 `status!=='escalated'`면 `{status:'skipped'}`(early guard). ②`newAttempt = cur.attempt + 1`(**advance** — 0 리셋 금지, D2 참조: 멱등키 충돌→워커 dedup 드롭). ③`transition`(기존 공통 tx) 재사용: `UPDATE wp_leases SET status='active', attempt=$newAttempt, expires_at=now+visibilityMs, event_id=$env, updated_at=NOW() WHERE wf,wp AND status='escalated' RETURNING wp_id`(escalated→active 단방향 WHERE-가드 유지·0행→skip·TOCTOU/동시 reopen 직렬화) + `appendWpEvent`(eventType `WP_DISPATCHED_EVENT`·fromState `ESCALATED_STATE`·toState `DISPATCHED_STATE`·reason `'human_fix_reverify'`·attempt `newAttempt`·stepN `cur.stepN`(실제 step_n)). 멱등키는 newAttempt + event_type(appendWpEvent가 분리). `wpEnvelope(wf, wpId, newAttempt, now, causationId)`(causationId=requestId 스레딩·M7). 반환에 `attempt: newAttempt` 포함 → 소비자가 그 attempt로 `dispatch_signal` 발행(0 하드코드 제거).

### 4.2 `streams/decision-consumer.ts` (신규)
`oracle-consumer.ts` 패턴. `DecisionRecordedSchema`(envelope+`type:'decision.recorded'`+payload `{decisionId, requestId, choice, routedTo, decidedBy}`). `buildDecisionRecordedHandler(deps: { decisionStore, leaseStore, publish, visibilityMs, log? })`:
- `fix_reverify`: `req = await decisionStore.getRequest(requestId)`; `req?.wpId`면 `r = await leaseStore.reopenLease({ workflowId: req.workflowId, wpId: req.wpId, visibilityMs, causationId: requestId })`; `r.status==='reopened'`면 `publishDispatchSignal(publish, req.workflowId, req.wpId, r.attempt, now)`(reopen이 반환한 **advanced attempt** — 0 하드코드 금지, 멱등키 충돌 회피). req/wpId 부재·skip이면 no-op.
- 그 외/미지 choice: `log?.info` 후 no-op.
- never-throw(try/catch 흡수). `DecisionRecordedConsumer extends BaseConsumer`(group `manager-decision-consumers`·prefix `manager:decision`·dedup ON·`start('main')`→`manager:decision:main`).

### 4.3 `api/decision.route.ts` (신규)
`POST /workflows/:workflowId/decisions/:requestId/decision` — body Zod `{ decidedBy:string, choice:enum, justification?:string }`. `CHOICE_TO_ROUTED`(fix_reverify→`'impl'`·spec_fix→`'task'`·accept_known→`'gate_override'`·reject→`'saga_rollback'`) 결정론 매핑. `decisionId = ${requestId}:${choice}`(멱등). `getRequest` 부재→404·비-PENDING→409. `recordDecision({decisionId, requestId, decidedBy, choice, routedTo, justification})`→200 `{ok, eventId}`. authHook 설정 시 서비스 JWT 보호(oracle.route 패턴).

**workflowId IDOR 게이트(fail-close)**: `getRequest(requestId)` 조회 후 `recordDecision` **전에** `!existing || existing.workflowId !== params.workflowId`이면 **404**(403 아님 — 존재 오라클 회피)로 거부한다. requestId만으로 결정을 기록하면 다른 워크플로의 결정 요청을 URL workflowId 무관하게 변조할 수 있는 IDOR. `decidedBy` 본문 필드(사람 신원·oracle.route `approvedBy`와 동일 서비스-JWT 경계 규약)와 optional-authHook 패턴은 보존(권한 게이팅은 server.ts 등록 지점에서 후속 강제).

### 4.4 배선 — `supervisor.ts`·`server.ts`·`config.ts`
- `config.ts`: `MANAGER_DECISION_ROUTING`(string→boolean default false).
- `SupervisorConfig.decisionRouting`. `createSupervisor`가 `decisionRouting && decisionStore`면 `DecisionRecordedConsumer`를 전용 Redis 연결(makeRedis)로 조건부 생성→start/stop. deps에 `leaseStore`·`publish`·`visibilityMs` 합류(이미 lease sweep용 주입됨).
- `server.ts`: `MANAGER_DECISION_ROUTING`+pool이면 `decisionRoute`에 `DecisionRepo` 주입(authHook 보호) + `createSupervisor`에 `decisionRouting` 전달 + OutboxRelay 기동 조건에 `MANAGER_DECISION_ROUTING` 추가(decision.recorded 발행 필수). 오진 경고: routing on인데 `MANAGER_DECISION_BRIEF` off(브리프 없으면 라우팅 대상 0).

## 5. 테스트

### 5.1 단위
- `buildDecisionRecordedHandler`: fix_reverify+req.wpId+reopen success → `reopenLease`+`publishDispatchSignal` 호출. fix_reverify+req 부재 → no-op. fix_reverify+reopen skip → 신호 미발행. spec_fix/reject/accept_known/미지 → no-op(폐루프 미차단). throw 흡수.
- decision.route: choice→routedTo 매핑·recordDecision 호출 인자·404(미존재)·409(비-PENDING)·400(검증).
- `buildWorkerConsumerDeps`/createSupervisor 게이트: decisionRouting → 소비자 배선 행동 단언(SonarCloud 신규커버).

### 5.2 DB 통합(skip-if-no-DB)
`reopenLease`: escalated lease → reopened(active·attempt 0·wp_state_log ESCALATED→DISPATCHED). 비-escalated → skip. + end-to-end: escalate→defect_brief→recordDecision(fix_reverify)→decision.recorded→소비자→reopenLease→dispatch_signal.

### 5.3 회귀 0
`MANAGER_DECISION_ROUTING` off면 소비자·라우트 미배선(#291 브리프 동작 불변).

## 6. 한계·비-목표 (정직)

- **spec_fix(재분해)·reject(saga)·accept_known(게이트 통과 unblock)** 실동작은 후속(P2 재분해 트리거·P5 saga·게이트 연동 의존). 이 슬라이스는 매핑·로깅만.
- **EXPIRED sweep**(pending 결정 만료 타이머→비-무음 에스컬레이션)은 별도 슬라이스.
- **UI 결정 카드**(Orchestrator: defect_brief 표시·결정 제출)는 별도(현재 Manager HTTP 라우트만).
- **진동 누적**(4c task/plan 승급·graph_dag attribution 영속)은 반복 fix_reverify를 세는 후속 — 현재 사람 게이트가 매번 차단.
- **다른 브리프 소스**(verification.failed·decomposition.inconsistent)는 별도.
- 비-목표(YAGNI): saga 인프라·재분해 트리거·새 migration(decision_requests/wp_leases 기존 재사용).
