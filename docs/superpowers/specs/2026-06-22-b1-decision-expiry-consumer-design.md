# B1 — 만료 결정 소비자 (decision.expired 폐루프 · 바운드 재에스컬레이션)

**날짜**: 2026-06-22
**상태**: 설계 승인됨(브레인스토밍 → 본 스펙)
**원천 스펙**: `docs/senario/` M8(무음 통과·무음 소멸 금지) · HUMAN_DECISION_PERSISTENCE.md(M9 결정 생명주기)
**선행 슬라이스**: P6 M9 의사결정 영속(#288) · P6 결함 브리프 배선(#291) · P6 사람 결정 라우팅 fix_reverify(#299) · C0/C1 결정 대기함 UI(#303·#306) · B1 EXPIRED sweep 생산측(#312)

## 배경

#312가 결정 만료 sweep(생산측)을 배선했다: `DecisionSweeper`(`MANAGER_DECISION_EXPIRY`)가 만료된 PENDING 결정을 `expireRequest`로 EXPIRED 전이하고 `decision.expired`(`{requestId, status:'EXPIRED', workflowId}`)를 `manager:decision:main`에 발행한다.

그러나 **그 이벤트를 소비하는 주체가 없다**(재감사 post-#312 §4-(4)). 유일한 구독자 `DecisionRecordedConsumer`(`decision-consumer.ts:44`)는 `msg.type !== DECISION_RECORDED_EVENT`이면 `return`으로 무시한다. 결과: 만료된 blocking 결정(사람이 TTL 내 응답 안 한 결함 브리프·강등 사인오프·리스크 분류)이 **재에스컬/통지 없이 소멸**한다 — senario M8(무음 소멸 금지) 위반·결정 생명주기의 열린 종단.

B1은 그 종단을 닫는다: **`decision.expired`를 소비해 만료된 blocking 결정을 바운드 재에스컬레이션**(새 PENDING DecisionRequest 재생성)함으로써 기존 C1 결정 대기함에 다시 노출하고, 상한 소진 시 구조적 warn 로그로 종단한다.

## 범위 결정 (브레인스토밍 확정)

- **바운드 재에스컬레이션**(운영자 통지-only 아님): 만료 시 새 PENDING DecisionRequest를 재생성해 기존 UI(C1 `pendingByProject` 폴링)로 사람에게 **재도달**. 순수 로그/메트릭은 UI에 안 떠 약한 surface라 기각.
- **상한 기본 1회**(`MANAGER_DECISION_REESCALATE_MAX`): 한 번 재도달 후 다시 만료되면 종단. 알람 피로 최소·대부분 일시적 부주의는 1회로 충분.
- **상한 소진 후 = 구조적 warn 로그만**: EXPIRED 종단 유지. 새 orphan 이벤트(소비자 없는 `decision.escalation_exhausted` 등) 미발행.
- **별도 소비자**(기존 핸들러 확장 아님): 아래 §2 근거.
- **flag 재사용** `MANAGER_DECISION_EXPIRY`(생산자와 동일 — 소비자가 생산자와 함께 활성화, orphan 0). 신규 flag 없음.

## 아키텍처 (데이터 흐름)

```
[#312 생산자] DecisionSweeper (MANAGER_DECISION_EXPIRY)
   → expiredPendingRequests(now) → expireRequest(id) (PENDING→EXPIRED)
   → decision.expired {requestId, status, workflowId} → manager:decision:main (outbox→relay)

[B1 신규] DecisionExpiredConsumer (별도 그룹·동일 스트림·동일 flag)
   handler(msg):
     msg.type !== decision.expired           → return
     orig = getRequest(requestId); !orig      → return (소멸 경합·이미 정리)
     orig.severity !== 'blocking'             → return (advisory 만료는 드롭)
     depth = parseReesc(requestId)            // 접미사 :reesc{n} → n, 없으면 0
     depth >= max                             → warn 로그(종단) · return
     nextId = stripReesc(requestId):reesc{depth+1}
     createRequest({...orig 복사, requestId: nextId, expiresAt: now+TTL,
                    context: {...orig.context, impact: [...impact, "re-escalated from {requestId} (attempt {depth+1})"]}})
       → 새 PENDING (decision.requested outbox) → C1 pendingByProject 재노출

재에스컬된 nextId도 expiresAt 보유 → 다음 sweep 주기에 재만료 → 같은 소비자가 depth+1 인지 → 상한 종단. 폐루프.
```

## 컴포넌트

### 신규 `streams/decision-expiry-consumer.ts`

- **별도 소비자 채택 근거**: `buildDecisionRecordedHandler`(decision-consumer.ts)는 **wire되면 recorded 분기를 무조건 처리**한다(내부 routing flag 가드 없음 — 라우팅 게이트는 consumer 배선 여부로만 강제). 이 핸들러를 EXPIRY 경로에서 재사용하려고 wiring 조건을 `routing || expiry`로 넓히면, EXPIRY-on/ROUTING-off 상태에서 fix_reverify(reopenLease) 라우팅 동작이 **누설**된다(불변식 "ROUTING off → 재진입 0" 파괴). 따라서 P5-2a `ReleaseSignoffConsumer` 선례대로 **별도 클래스·별도 그룹**으로 격리한다. BaseConsumer 골격·느슨한 `DecisionEventSchema`(envelope+type+payload)는 import 재사용("골격 재사용").
- **`buildDecisionExpiredHandler(deps): (msg) => Promise<void>`**:
  - `msg.type !== DECISION_EXPIRED_EVENT` → return.
  - `getRequest(requestId)` null → return(만료 후 정리 경합 — 무해).
  - `req.severity !== 'blocking'` → return(advisory 만료는 재에스컬 불요).
  - `depth = parseReescDepth(requestId)`; `depth >= maxReescalations` → 구조적 warn 로그(`requestId`·`workflowId`·`type`·`depth`) 후 return(종단).
  - else `createRequest`(아래 매핑)로 재에스컬.
  - **never-throw**: 전체 try/catch — 어떤 실패(getRequest·createRequest·파싱)도 흡수(결정은 이미 EXPIRED 영속·소비자 크래시 금지). best-effort 경고 로그.
- **`DecisionExpiredConsumer extends BaseConsumer<DecisionEventMessage>`**: group `manager-decision-expiry-consumers`·prefix `manager:decision`·`start('main')` → `manager:decision:main`·dedup ON. `DecisionRecordedConsumer` 미러.

### 깊이 인코딩 (순수 헬퍼)

- **`parseReescDepth(requestId): number`** — `/:reesc(\d+)$/` 매치 시 그 수, 없으면 0.
- **`stripReescSuffix(requestId): string`** — 끝의 `:reesc\d+` 제거(체인을 원본 base에 고정 → 멱등키 안정: `base`→`base:reesc1`→`base:reesc2`).
- **`nextReescId(requestId): string`** = `${stripReescSuffix(requestId)}:reesc${parseReescDepth(requestId)+1}`.

### 재에스컬 입력 매핑 (`createRequest`)

원본 `DecisionRequest`(`getRequest` 반환)에서 복사:
- `requestId`: `nextReescId(requestId)` (신규·결정론·멱등 base)
- `type`·`workflowId`·`correlationId`·`wpId`·`projectId`·`severity`·`language`: **원본 그대로** (fix_reverify가 wpId로 reopenLease·C1이 projectId로 노출)
- `context`: `{...orig.context, impact: [...orig.context.impact, "re-escalated from {requestId} (attempt {depth+1})"]}` (운영자에게 재에스컬 표식)
- `expiresAt`: `new Date(now + ttlMs).toISOString()` (다음 sweep 대상)

`createRequest`는 ON CONFLICT (request_id) DO NOTHING 멱등(M6) — 재전달 시 reesc1 1회만 생성. causationId는 `createRequest` 규약상 null(체인 추적은 requestId 접미사·context 표식으로 충분·M7 강화는 비범위).

## 배선 & config

- **`config.ts`**: 신규 `MANAGER_DECISION_REESCALATE_MAX`: `z.coerce.number().int().positive().default(1)`(기존 `MANAGER_DECISION_TTL_HOURS`/`MANAGER_DECISION_SWEEP_MS`와 동일 패턴 — 0/음수/비수치는 검증 거부·NaN은 coerce 실패로 기동 거부, fail-safe 상한 무력화 차단). TTL은 기존 `MANAGER_DECISION_TTL_HOURS`(→`decisionTtlMs`) 재사용·sweep 주기는 기존 `MANAGER_DECISION_SWEEP_MS`.
- **`supervisor.ts`**: `SupervisorComponents.decisionExpiryConsumer?` 추가·`SupervisorConfig.decisionReescalateMax?` 추가. `config.decisionExpiry && deps.decisionStore`이면 `DecisionExpiredConsumer` 생성(전용 Redis 연결 `makeRedis()`)·start/stop 배선. `decisionStore`는 이미 EXPIRY 조건에 포함(server.ts:208)이라 `getRequest`/`createRequest` 충족.
- **`server.ts`**: `decisionReescalateMax: config.MANAGER_DECISION_REESCALATE_MAX` 전달. OutboxRelay는 이미 `MANAGER_DECISION_EXPIRY` 조건 포함(server.ts:190) — 재에스컬 `decision.requested` 아웃박스→Redis 발행 보장.
- **`.env.example`·문서**: `MANAGER_DECISION_REESCALATE_MAX` 추가.

## flag · 전제

- **`MANAGER_DECISION_EXPIRY`**(기본 false·재사용): on이면 생산자(sweep)+소비자(재에스컬) 동시 활성. 전제: `TASK_MANAGER_ENABLED`(Supervisor)+`DATABASE_URL`(DecisionRepo). off → 소비자 미배선·회귀 0.
- **`MANAGER_DECISION_REESCALATE_MAX`**(기본 1).
- **새 migration 없음**(`011 decision_requests`·`createRequest`/`getRequest`/`expireRequest` 기존).

## 검증 (TDD)

- **`parseReescDepth`/`stripReescSuffix`/`nextReescId`(순수·unit)**: 접미사 없음→0·`base`→`base:reesc1`·`base:reesc1`→depth 1·`base:reesc2`·colon 포함 base(`wf:wp:0`) 안정.
- **`buildDecisionExpiredHandler`(unit·mock store)**:
  - non-expired type → no-op(getRequest 미호출).
  - blocking·depth 0 → `createRequest` nextId=`base:reesc1`·expiresAt 설정·orig 필드 복사·impact 표식.
  - advisory severity → no-op(재에스컬 안 함).
  - depth >= max(1) → createRequest 미호출·warn 로그(종단).
  - getRequest null → no-op.
  - createRequest throw → never-throw(흡수).
- **`supervisor.ts` 배선(unit)**: `decisionExpiry && decisionStore` → consumer 생성·start/stop·미충족 시 미생성(회귀 0).
- **E2E DB 통합(`test/decision-expiry-consumer.integration.test.ts`·skip-if-no-DB·`wf-de-` prefix)**: createRequest(expiresAt 과거)→`handleDecisionSweep`(EXPIRED·decision.expired)→handler 소비→`pendingByWorkflow`에 `base:reesc1` PENDING 확인→그 reesc1을 다시 만료→handler→상한(1) 종단(추가 재에스컬 없음).

## 수용 기준

1. `MANAGER_DECISION_EXPIRY` off → 소비자 미배선·회귀 0(생산자도 미배선).
2. on + blocking 만료(depth 0) → `{base}:reesc1` PENDING 재생성(expiresAt 보유·orig wpId/projectId 복사) → C1 패널 재노출.
3. reesc1 재만료(depth 1 = max) → 재에스컬 없음·구조적 warn 로그·EXPIRED 종단.
4. advisory severity 만료 → 재에스컬 안 함(no-op).
5. 재전달(중복 decision.expired) → `createRequest` ON CONFLICT 멱등 → reesc1 1회만.
6. handler 어떤 내부 실패도 never-throw(소비자 생존).

## 비범위 (후속 — 명시)

- **운영자 알림 소비자/스트림**(상한 소진 시 push 알림·메트릭/SLO) — 현재 종단=warn 로그.
- **재에스컬 시 우선순위/권한 격상**(higher authority tier)·tiered 통지.
- **M7 causation 체인 강화**(createRequest causationId=expired requestId).
- **재분해 시 EXPIRED 결정 보존**·spec_fix/reject 실동작(별도 트랙).
