# P0 슬라이스 1 — Manager 세션 이벤트소싱 + 트랜잭셔널 아웃박스

- 작성: 2026-06-05
- 상태: 설계 승인됨 → 구현 계획(writing-plans) 대기
- 원천: senario `ROADMAP.md` Phase 0, `WP0_DECISIONS.md` #4(진실원천), `xzawedPAIS_handoff_spec.md` §16·§18-2 (M4/M5/M7)
- 선행: PR #239(event-envelope 스키마), PR #242(게이트 fail-safe)
- 브랜치: `feat/manager/event-sourcing-outbox` (master 91ad8a2 분기)

## 1. 배경과 목표

### 현재 문제 (dual-write)
`xzawedManager`의 `session.store.ts`는 인메모리 `Map<string, SessionEntry>`를 진실원천으로 두고, `SessionRepo`에는 `void this.repo?.updateState(...)` **fire-and-forget**으로 거울만 쓴다. 상태 변경과 영속화가 비원자적이고, 프로세스가 죽으면 진행 중 상태를 복원할 수 없다.

### 목표 (senario Phase 0)
모든 폴백의 토대 — **어떤 컴포넌트가 죽어도 로그에서 복원 가능한 상태**.
- **M4 이벤트소싱**: append-only 이벤트 로그가 진실원천. 상태는 이벤트 재생(replay)으로 파생.
- **M5 트랜잭셔널 아웃박스**: 상태 변경과 이벤트 발행을 단일 트랜잭션으로 원자화(dual-write 금지).
- **M7 인과 추적**: 모든 이벤트에 `correlation_id` + `causation_id`.

### 수용 기준 (ROADMAP P0)
1. 상태 변경과 이벤트 발행이 단일 트랜잭션으로 원자적(dual-write 부재 검증).
2. 임의 컴포넌트 강제 종료 후 재기동 시 이벤트 로그 재생으로 상태 복원(테스트).
3. 모든 이벤트에 `correlation_id` + `causation_id` 존재.

## 2. 범위

### 이 슬라이스에 포함 (확정)
- **Manager 세션 생명주기** 상태만 이벤트소싱: `SessionCreated` · `SessionStateChanged`(idle/running/waiting_info) · `SessionDeleted`.
- append-only `manager_events`(진실원천) + 트랜잭셔널 `manager_outbox`(M5).
- Node 폴링 릴레이(`OutboxRelay`) → Redis 발행(at-least-once).
- 시작 시 `replaySessions()` 복원.
- `EVENT_SOURCED_SESSION` feature-flag(기본 off), 인메모리 폴백 보존(가역).

### 명시적 비범위 (후속)
- **게이트/승인 결정 이벤트소싱** — 후속 슬라이스(WP0 비평 #4 에스컬레이션 부인방지는 별도).
- **#6 RBAC 강제 · #7 DB 레벨 불변성 트리거** — 미결정. 본 슬라이스는 **가역 스키마**로만 준비(아래 §3).
- **멱등 소비 · DLQ · lease · 다중 릴레이 동시 클레임** — P1(Event Bus + Task Manager). 본 슬라이스의 OutboxRelay는 **단일 인스턴스 + 재진입 가드** 전제(at-least-once). 다중 릴레이 안전(tx 내 `FOR UPDATE SKIP LOCKED` + `published_at` 선점)은 멱등 소비와 함께 P1.
- **EventBus 어댑터 · WP 액터 강등** — P1/별도 PR.
- **휘발 런타임(AbortController·infoResolve/infoReject)의 resumable 복원** — 깊은 P1 관심사. 본 슬라이스는 영속 `state`·세션 존재만 복원.
- **replay 스냅샷/체크포인트** — 본 슬라이스는 전체 이벤트 full-scan replay. 장기 운영 시 부팅 replay 누적을 피하는 스냅샷/아카이브는 P1.

## 3. 미결정 의존(#6/#7)에 대한 가역 결정

이벤트소싱 특성상 append-only는 전제다. 미결정인 **actor 기록·불변성 강제 수준**은 다음으로 가역 처리한다:
- `manager_events.actor`를 **nullable 컬럼**으로 포함(현재 `'manager'`/`'system'` 기록). provenance를 제공일부터 확보.
- append-only는 **코드 규약**으로 강제(repo가 `manager_events`에 INSERT만, UPDATE/DELETE 없음). **DB 레벨 불변성 트리거는 도입하지 않음** — #7의 불변성 메커니즘(트리거 vs 파티션 vs WORM) 선택을 선점하지 않기 위함.
- **RBAC 미강제**(#6 미결정). 이벤트는 Manager 자신이 발행(system actor).
- #6/#7 확정 시: `actor` NOT NULL · 불변성 트리거 · RBAC 체크를 **additive 마이그레이션**으로 강화(비파괴).

## 4. 아키텍처 (컴포지션)

`SessionStore`(인메모리 세션 투영 + wait 코디네이션)와 `EventStore`(durable 로그 + outbox + replay)를 각각 **한 가지 책임**으로 분리한다. flag off에서는 기존 코드 경로를 100% 보존한다.

```
create/전이 → EventStore.appendSessionEvent()
              { BEGIN; INSERT manager_events; INSERT manager_outbox; COMMIT }
            → 인메모리 Map(투영) 갱신
            → (OutboxRelay 폴링) 미발행 outbox → Redis 발행 → published_at 설정
크래시 후 재기동 → EventStore.replaySessions() → events seq순 fold → Map 복원 → listen
```

원자성은 `manager_events` row와 `manager_outbox` row 사이(단일 tx)에서 성립한다. 인메모리 Map은 커밋 **이후** 갱신되는 투영이다. 커밋 후 Map 갱신 전 크래시 → 재기동 replay가 Map 복원(일관). tx 중간 크래시 → 롤백(이벤트·outbox 둘 다 미기록, 전이 미발생, 일관).

## 5. 스키마 — `006_events_outbox.sql`

```sql
-- append-only 이벤트 로그 = 진실원천 (M4). 코드 규약으로 INSERT만(UPDATE/DELETE 없음)
CREATE TABLE IF NOT EXISTS manager_events (
  seq             BIGSERIAL   PRIMARY KEY,            -- 전역 순서(replay 정렬)
  event_id        UUID        NOT NULL UNIQUE,        -- envelope.eventId
  session_id      TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,               -- SessionCreated|SessionStateChanged|SessionDeleted
  payload         JSONB       NOT NULL DEFAULT '{}',  -- 예: {"state":"running"}
  correlation_id  TEXT        NOT NULL,               -- M7
  causation_id    TEXT        NULL,                   -- M7 (루트 null)
  idempotency_key TEXT        NOT NULL,               -- {sessionId}:{type#n}:{attempt} (M6)
  actor           TEXT        NULL,                   -- #6/#7 forward-compat (지금 'manager')
  occurred_at     BIGINT      NOT NULL,               -- epoch ms
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manager_events_session ON manager_events (session_id, seq);

-- 트랜잭셔널 아웃박스 (M5) — 이벤트와 같은 tx로 적재, 릴레이가 발행
CREATE TABLE IF NOT EXISTS manager_outbox (
  id           BIGSERIAL   PRIMARY KEY,
  event_id     UUID        NOT NULL REFERENCES manager_events(event_id),
  stream       TEXT        NOT NULL,                  -- 발행 대상 Redis 스트림
  message      JSONB       NOT NULL,                  -- Redis로 보낼 페이로드
  published_at TIMESTAMPTZ NULL,                      -- NULL=대기
  attempts     INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manager_outbox_pending ON manager_outbox (id) WHERE published_at IS NULL;
```
마이그레이션은 기존 `pool.ts runMigrations`(디렉터리 사전순 자동 적용)로 반영된다.

## 6. 컴포넌트

### `db/event-store.ts` — `EventStore`
- `appendSessionEvent({ sessionId, type, payload, prevEventId }): Promise<EventEnvelope>` — 단일 tx로 `manager_events` + `manager_outbox` INSERT(BEGIN/COMMIT, 실패 시 ROLLBACK). envelope(#239 `makeEnvelope`)로 식별·상관 채움:
  - `correlationId = sessionId`(한 세션 = 한 상관 컨텍스트, 본 슬라이스 한정)
  - `causationId = prevEventId`(세션의 직전 이벤트 eventId, 첫 이벤트는 null)
  - `workflowId = sessionId` · `stepId = ${type}#${perSessionSeq}` · `attemptId = 0`
  - outbox.stream = `manager:events:${sessionId}`, message = `{ envelope, type, payload }`
- `replaySessions(): Promise<Map<sessionId, SessionState>>` — 전 이벤트를 `seq`순 로드 → 세션별 최종 state로 fold(SessionDeleted면 제거).
- pg `Pool`에서 `connect()` → tx. **세션별 직전 eventId는 `SessionStore`의 인메모리 투영이 추적**해 `prevEventId`로 전달한다. 한 세션의 전이 직렬화는 두 층으로 보장: ① production은 단일 consumer + runner가 `await waitForInfo`로 블로킹(append 완료 후에만 wait 반환), ② `resolveInfo`·`abort`는 **append를 waiter wake보다 먼저** 실행해, 깨어난 runner가 다음 전이를 일으키기 전에 `prevEventId`가 진행되도록 한다(causation read-modify-write 레이스 차단). waiter 핸들 capture·clear는 동기 유지(직후 호출 no-op 불변식). 완전한 동시 전이 직렬화(per-session 락)는 P1.

### `streams/outbox-relay.ts` — `OutboxRelay`
- `setInterval`(`MANAGER_OUTBOX_POLL_MS`, 기본 500ms) 폴러. 각 틱:
  `SELECT … WHERE published_at IS NULL ORDER BY id LIMIT N`
  → 각 row를 `StreamProducer.publishRaw`로 `stream`에 발행(xadd null 시 throw) → `UPDATE published_at = NOW()`.
- **재진입 가드**(`polling` 플래그): 느린 발행으로 틱이 겹쳐도 동시 `pollOnce`를 막아 단일 릴레이 내 이중 발행을 차단한다. (tx 밖 `FOR UPDATE SKIP LOCKED`는 락이 즉시 해제되어 무효이므로 미사용 — 다중 릴레이 클레임은 P1.)
- **at-least-once**(멱등 소비는 P1). 발행 실패·`published_at` UPDATE 실패 시 pending 유지 · `attempts++`(다음 틱 재발행). `stop()`은 진행 중 발행을 드레인하지 않아 종료 직후 미발행 row는 다음 기동 시 재발행될 수 있다(at-least-once 허용). DLQ·알림은 P1.
- `start()` / `stop()`. `server.ts closeAll`에서 stop.

### `SessionStore` 확장 (컴포지션)
- optional `eventStore`. flag on이면 전이 메서드가 `await eventStore.appendSessionEvent()` 후 Map 갱신. flag off면 현재 동작(인메모리 + fire-and-forget repo).
- 영속 대상 = `state` · 세션 존재. **휘발 런타임**(AbortController·infoResolve/infoReject)은 replay 시 새로 생성(빈 상태). 크래시 후 waiting_info였던 세션은 state는 복원되나 대기 중이던 호출자는 이미 사라졌으므로 pending waiter 없음(본 슬라이스 수용 범위).
- dual-write 제거를 위해 전이 메서드 일부가 **async화**된다(append await). 영향 call site(소수)는 await로 수정.

### 배선 (`server.ts`)
- flag on + `DATABASE_URL`이면: `EventStore`·`OutboxRelay` 생성, `replaySessions()` → Map 재구성 후 listen, relay start. `closeAll`에서 relay stop.
- flag on인데 `DATABASE_URL` 없음 → 경고 후 인메모리 폴백(부팅 차단 안 함).

### Feature flag
`EVENT_SOURCED_SESSION`(기본 `false`) — `config.ts` 등록 + `DATABASE_URL` 동반 필요.

## 7. 에러 처리·안정성
- append tx 실패 → throw(전이 미반영·Map 미갱신 — dual-write 0). 호출자 처리.
- relay 발행 실패 → outbox pending 유지(다음 틱 재시도, at-least-once) · `attempts` 누적.
- flag on + no `DATABASE_URL` → 경고 후 인메모리 폴백.
- append-only는 코드 규약. DB 트리거·RBAC는 #6/#7 확정 후 additive.
- 보안: `MANAGER_OUTBOX_POLL_MS`는 양의 정수 파싱(잘못된 값 방어, PR-1의 `parsePositiveInt` 패턴 재사용). outbox `message`는 신뢰 경계 내(Manager 자신 생성)이나 발행 시 기존 `StreamProducer` 검증 경로 유지.

## 8. 테스트 (TDD)
- **`EventStore`**: append 단일 tx(events+outbox 동시 커밋; 실패 주입 시 둘 다 0 — 롤백), replay fold(create→전이→delete 시퀀스 → 올바른 최종 state·삭제 반영), envelope 필드(correlation=sessionId·causation=직전 eventId·idempotency 형식).
- **`OutboxRelay`**: 미발행만 발행 · published_at 설정 · 발행 실패 시 pending 유지(at-least-once) · 폴링 mock으로 SKIP LOCKED 동시성 가정 검증.
- **`SessionStore`(event-sourced)**: 전이가 append 후 Map 갱신 · flag off 경로 불변(기존 테스트 그린) · replay 주입 후 state 복원.
- **수용기준 통합 테스트**: 이벤트를 events 테이블에 주입 → 새 store 인스턴스 `replaySessions()` → state 일치(크래시-복원 시뮬). pg 통합 테스트는 `DATABASE_URL` 없으면 skip(기존 Redis 통합 패턴 동일).

## 9. 수용기준 매핑
| 수용기준 | 충족 방법 |
|---|---|
| (1) 상태+이벤트 원자성 | `appendSessionEvent` 단일 tx(events+outbox), Map은 커밋 후 투영. EventStore 롤백 테스트. |
| (2) 강제종료 후 replay 복원 | `replaySessions()` fold + 통합 테스트(주입→새 인스턴스 replay→일치). |
| (3) correlation/causation | 모든 이벤트가 `makeEnvelope`로 correlation/causation 보유. EventStore 단정. |

## 10. 가역성·롤백
- `EVENT_SOURCED_SESSION=false`(기본) 또는 no `DATABASE_URL` → 기존 인메모리+fire-and-forget 경로 보존. 관측 가능한 상태(Map·state·resolver)는 모두 첫 await 전 동기 실행되어 기존 동기 호출 패턴이 유지된다. 단, 전이 메서드가 async가 되어 best-effort `repo` 미러(`void this.repo?.…`) 호출만 master 대비 한 마이크로태스크 뒤로 밀린다(비차단·미관측 — 기능 영향 없음).
- 마이그레이션은 additive(`CREATE TABLE IF NOT EXISTS`) — 기존 데이터·테이블 무영향.
- flag on에서도 `manager_sessions`(기존) 테이블은 그대로 둠(레거시 경로용). 본 슬라이스는 신규 `manager_events`만 진실원천으로 사용.
