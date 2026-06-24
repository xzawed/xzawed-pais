# C7 — 분해 불일치(decomposition.inconsistent) dead-end 폐합

- 날짜: 2026-06-24
- 상태: 설계 승인 대기
- 서비스: xzawedManager
- 로드맵: [[project-reaudit-post344]] Tier1 **1순위**(C6 정문 첫 노출 실패 경로)
- 선행: C6 intake 라우터(#337/#339·`decompose_request` 라이브 생산)

## 1. 문제 (재감사 진단 정정 포함)

C6 머지로 `decompose_request` → 자율 분해 아크가 라이브 경로에 진입했다. 분해가 실패하면 `decomposition.inconsistent`가 발행되지만, **이 신호를 소비해 사람에게 노출하는 경로가 불완전**하다. `manager:events:{wf}` 스트림에는 이 이벤트의 **소비자가 0개**(grep 확정 — `OutboxRelay`는 이 스트림에 *발행*만, 소비 안 함; Orchestrator는 `manager:to-orchestrator:{sessionId}`만 소비).

재감사(post-#344)는 이를 "trigger catch에 publishError 재사용"으로 닫으라 했으나, **라이브 코드 확인 결과 그 진단은 빗나간다.** `decomposition.inconsistent`는 **두 곳**에서 발행되고 노출 상태가 다르다:

### 경로 A — repair 소진 (coverage)
- 위치: [`decompose/producer.ts:96-113`](../../../xzawedManager/packages/server/src/decompose/producer.ts) (`produceDecomposition` → `result.status === 'inconsistent'`).
- 트리거 [`decompose/trigger.ts:34-43`](../../../xzawedManager/packages/server/src/decompose/trigger.ts)가 `escalated=true`를 받아 **이미 `task_complete`로 "분해 불일치… 에스컬레이션" 메시지를 `manager:to-orchestrator:{wf}`에 발행** → 사용자에게 보임.
- **결함**: escalation을 `task_complete`(완료) 타입으로 위장(충실도 결함). trigger의 `catch` 블록은 *thrown 에러*(워크스페이스·발행 실패)만 잡으므로 이 정상-반환 escalation에는 무관 — 즉 재감사의 "catch publishError"는 이 경로를 건드리지 못한다.

### 경로 B — 사이클/구조오류 (cycle/structural) — **진짜 무음 dead-end**
- 위치: [`streams/decomposition-consumer.ts:98-108`](../../../xzawedManager/packages/server/src/streams/decomposition-consumer.ts) (`handleDecompositionEmitted` → `buildTaskGraph` throw 또는 `detectCycle`).
- Supervisor의 **비동기** `DecompositionConsumer`가 `decomposition.emitted`를 소비할 때 발생. 이 시점엔 trigger가 **이미 `task_complete: '분해 완료: N WP emitted'`를 발행하고 `cleanupSession`으로 세션을 teardown**한 뒤다.
- `emitInconsistent`가 `decomposition.inconsistent`를 `manager:events:{wf}`로 발행 → **소비자 0개** → **완전 무음 소멸 + 직전 "완료" 메시지와 모순**(M8 위반: 무음 통과 금지).

## 2. 목표 / 비목표

**목표**
- 두 inconsistent 경로 모두 사람에게 **충실하게** 노출(escalation을 완료로 위장하지 않음·무음 소멸 0).
- 진실원천 `decomposition.inconsistent` 이벤트는 양쪽 모두 **보존**(이벤트소싱 무결성).
- decision 스택(C0/C1/M9)이 켜져 있으면 **내구 DecisionRequest**로도 surface(세션 teardown 생존·감사추적).

**비목표 (의식적 후속)**
- **자동 재분해/수선**: inconsistent → re-decompose는 E10·spec_fix 라우팅(후속). 본 슬라이스는 *노출만* — 거짓 affordance(자동 고침 약속) 금지(D10 교훈).
- Orchestrator/UI 변경 0(C1 DecisionsPanel·error 렌더 재사용).
- shared 변경 0·migration 0.

## 3. 결정 (사용자 승인 완료)

1. **노출 방식 = 둘 다**: (arm 1) 무조건 user 스트림 `error` 즉시 노출 + (arm 2) decision 스택 켜짐 시 내구 DecisionRequest.
2. **경로 A 재타이핑**: `task_complete` → `error`로 통일(escalation은 완료가 아님). 두 경로가 동일한 "error + optional decision" 의미론.

## 4. 아키텍처

```
                       ┌─ 진실원천: decomposition.inconsistent → manager:events:{wf}  (양쪽 보존)
inconsistent 감지 ─────┤
 (경로 A: trigger)     ├─ arm 1 (무조건): error → manager:to-orchestrator:{wf}        (무음 봉합)
 (경로 B: consumer)    └─ arm 2 (DECISION_ROUTING): createRequest(decompose_inconsistent) → C1
```

### 4.1 공유 순수 모듈 — `streams/decompose-failure.ts` (신규)
두 경로가 공유(CPD 0). LLM/IO 0·결정론.

- `formatInconsistentReason(reason: InconsistentReason, detail?: string): string`
  - reason별 사람 가독 메시지. 예:
    - `cycle` → `'분해 불일치(cycle): 작업 그래프에 순환 의존이 있어 진행할 수 없습니다 — 사람 검토가 필요합니다.'`
    - `structural` → `'분해 불일치(structural): 작업 패키지 구조 오류(중복 ID·끊긴 의존)로 진행할 수 없습니다 — 사람 검토가 필요합니다.'`
    - `coverage` → `'분해 불일치(coverage): 커버리지 수렴에 실패해 진행할 수 없습니다 — 사람 검토가 필요합니다.'`
  - `detail`은 있으면 괄호로 덧붙임(500자 클램프).
- `buildDecomposeFailureBrief({workflowId, projectId, reason, detail?}): DecisionRequestInput`
  - `requestId = '${workflowId}:decompose-fail'`(결정론 멱등·`createRequest` ON CONFLICT DO NOTHING). 경로 A(producer escalation·emitted 없음)와 경로 B(emitted 후 consumer reject)는 **한 workflow에서 상호 배타**라 충돌 없음 — 설령 둘 다 발화해도 ON CONFLICT로 멱등.
  - `type: 'decompose_inconsistent'`·`wpId: null`·`severity: 'blocking'`·`correlationId: workflowId`·`projectId`
  - `context.options: ['accept_known']` — **자동 동작 없는 순수 확인**(재분해는 E10 후속·거짓 affordance 금지).
  - `context.location/expectedVsActual/impact/evidenceRefs`는 reason·detail 기반. `buildOracleBrief`/`buildSignoffBrief` 미러.

### 4.2 결정 타입 — `db/decision.types.ts`
- `DecisionRequestSchema.type` `z.enum([...])`에 `'decompose_inconsistent'` 추가. **migration 0**(DB `type` 컬럼은 TEXT — C5 `risk_classification`·N2 `degraded_dispatch` 선례).
- decision-consumer에 **능동 핸들러 추가 없음**: `decompose_inconsistent` + `accept_known`은 기존 흐름에서 `recordDecision`으로 **확인만 영속(M9 감사)**, 후속 동작 0. (재진입은 E10·후속.)

### 4.3 경로 B — `streams/decomposition-consumer.ts`
- `DecompositionDeps`에 `notifyUser?: (workflowId: string, content: string) => Promise<void>` 추가. (`decisionStore?`는 C3가 이미 추가함 — 재사용.)
- `emitInconsistent` 호출부(structural·cycle 두 분기) 직후 공통 후처리:
  1. `emitInconsistent(...)` — 진실원천(기존·보존).
  2. arm 1: `await deps.notifyUser?.(wf, formatInconsistentReason(reason, detail))` — **best-effort**(try/catch 삼킴·소비 비차단).
  3. arm 2: `deps.decisionStore && projectId != null`이면 `await deps.decisionStore.createRequest(buildDecomposeFailureBrief({...}))` — **best-effort never-throw**(영속/소비 비차단·C3 oracle 패턴 미러).
  - `projectId`는 `msg.payload.userContext?.projectId ?? null`.
  - 두 분기 공통이므로 `surfaceInconsistent(msg, deps, reason, detail)` 헬퍼로 추출(인지복잡도↓·S3776).

### 4.4 경로 A — `decompose/trigger.ts`
- `handleDecomposeRequest`가 `escalated=true`일 때:
  - **현재**: `task_complete` + 에스컬레이션 content.
  - **변경**: `error` 타입으로 `formatInconsistentReason('coverage')` 발행(재타이핑) + decisionStore 주입 시 `buildDecomposeFailureBrief` createRequest(best-effort).
- `escalated=false`(정상)는 `task_complete: '분해 완료: N WP'` 유지(변경 0).
- trigger 시그니처에 `decisionStore?`·`projectId`(userContext에서) 스레딩. `produceDecomposition`이 reason을 반환하지 않으므로(현재 `{emitted, escalated}`) coverage로 고정(producer escalation은 coverage 단일 reason — `producer.ts:106` 확인).
- ⚠️ **동작 변경**: 동작하던 경로의 `task_complete`→`error`. 기존 trigger 테스트가 task_complete를 단언하면 새 계약(error)으로 **명시 재작성**(무음 반전 금지·PR #295 교훈).

### 4.5 배선 — `streams/supervisor.ts` · `server.ts` · `config.ts`
- **arm 1 (notifyUser·무조건)**: DecompositionConsumer가 `manager:to-orchestrator:{wf}` 발행 능력 필요. `createSupervisor`에 `StreamProducer`(또는 `notifyUser` 클로저) 주입 → `notifyUser = (wf, content) => producer.publish({sessionId: wf, messageId, timestamp, type:'error', payload:{agentId:'manager', content}})`. **신규 flag 0**(무음 봉합은 무조건·g2 DLQ 선례). 단 경로 B는 DecompositionConsumer가 돌 때만 존재하므로 `TASK_MANAGER_ENABLED`가 자연 전제(미배선이면 surface할 경로 B 자체가 없음 — 누수 아님).
  - trigger는 이미 `producer`를 받음 — error 재타이핑은 추가 배선 0.
- **arm 2 (decisionStore·조건부)**: 현재 DecompositionConsumer의 `decisionStore`는 `MANAGER_ORACLE_DECISION`에만 묶여 주입됨. 이를 **`MANAGER_DECISION_ROUTING`에서도 주입**되도록 게이트 확장(`oracleDecisionActive || decisionRoutingActive`). trigger도 `MANAGER_DECISION_ROUTING`+pool 시 `decisionStore` 주입.
  - 전제: `MANAGER_DECISION_ROUTING`(+`DATABASE_URL`·`DecisionRepo`). off면 arm 2 미발행(arm 1만·회귀 0).
- **OutboxRelay**: arm 2의 `decompose_inconsistent` DecisionRequest는 `DecisionRepo.createRequest`가 단일 tx 아웃박스로 적재 → OutboxRelay 기동 조건에 이미 `MANAGER_DECISION_ROUTING` 포함(기존). 추가 0.
- 오진 방지 경고: `MANAGER_DECISION_ROUTING` off인데 decompose 활성 → "분해 실패가 C1에 surface되지 않음(error만)" 안내(arm 1은 여전히 동작).

## 5. 흐름 (end-to-end)

**경로 B (cycle 예)**: decompose_request → emitted(WP에 사이클) → DecompositionConsumer 소비 → `detectCycle>0` → `emitInconsistent`(진실원천) → `notifyUser`(error → 사용자) → [DECISION_ROUTING 시] `createRequest(decompose_inconsistent)` → C1 DecisionsPanel surface → 사람 `accept_known`(확인·M9 감사).

**경로 A (coverage)**: decompose_request → repair 소진 → `escalated=true` → trigger가 `error`(재타이핑·사용자) + [DECISION_ROUTING 시] `createRequest` → C1 surface.

## 6. 테스트 (TDD·red→green)

**순수 단위 (`decompose-failure.test.ts`)**
- `formatInconsistentReason`: cycle·structural·coverage 각 메시지·detail 클램프.
- `buildDecomposeFailureBrief`: requestId 멱등(`{wf}:decompose-fail`)·type·options `['accept_known']`·projectId 전파.

**경로 B (`decomposition-consumer.test.ts` 확장)**
- structural → `notifyUser` 1회(error content) 호출 + 진실원천 emit 유지.
- cycle → 동일.
- `decisionStore` 주입 + projectId 존재 → `createRequest` 1회(decompose_inconsistent brief).
- `decisionStore` 미주입 → createRequest 미호출(arm 1만).
- projectId null → createRequest 미호출(notifyUser는 호출).
- `notifyUser` throw → 소비 비차단(outcome inconsistent 정상 반환).
- `createRequest` throw → 소비 비차단.
- persisted(정상) 경로 → notifyUser/createRequest 미호출(회귀 0).

**경로 A (`trigger.test.ts` 재작성)**
- escalated → `error` 타입 발행(content=coverage 메시지)·**task_complete 아님**(계약 변경).
- escalated + decisionStore → createRequest 1회.
- escalated, decisionStore 미주입 → createRequest 미호출.
- 정상(emitted) → `task_complete: '분해 완료: N WP'` 유지.
- thrown 에러(워크스페이스) → 기존 catch publishError 경로 보존.

**회귀**
- 모든 flag off·decisionStore 미주입 → arm 2 미발행. arm 1(error)은 무조건(경로 B 무음 봉합).

## 7. 플래그·migration·blast-radius 요약

| 항목 | 값 |
|---|---|
| 신규 flag | **0** (arm 1 무조건; arm 2는 기존 `MANAGER_DECISION_ROUTING` 재사용) |
| migration | **0** (`decompose_inconsistent`는 Zod enum + DB TEXT 컬럼) |
| shared 변경 | **0** |
| Orchestrator/UI 변경 | **0** (error·C1 카드 재사용) |
| 동작 변경 | 경로 A `task_complete`→`error`(escalated만·정상 경로 불변)·경로 B 무음→error(봉합) |
| off 회귀 | DECISION_ROUTING off → arm 2 미발행·arm 1만(경로 B 봉합은 무조건이라 "회귀"가 아니라 의도된 신규 노출) |

## 8. 한계 (후속)

- **자동 재분해**: `decompose_inconsistent` 결정에 `spec_fix`/재분해 라우팅은 E10(graph_dag in-flight 보존)·후속. 현재 `accept_known` 확인만.
- **arm 1 비내구**: 경로 B의 error는 세션 teardown 이후 발행이라 Orchestrator 소비자가 이미 닫혔으면 미수신 가능 — 그래서 arm 2(내구 C1)를 병행(DECISION_ROUTING 켜짐 시 권장).
- per-reason 차등 옵션·decompose_inconsistent expiresAt(B1 TTL 참여)은 후속.
