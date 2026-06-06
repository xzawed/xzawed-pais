# P1b 멱등 소비(M6) — 키-무관 BaseConsumer dedup 설계

- 날짜: 2026-06-06
- 서비스: `xzawedShared` (`@xzawed/agent-streams`)
- 로드맵: senario ROADMAP Phase 1 복원력 사다리 — P1a('격리'=DLQ, #244) 다음 슬라이스. 사양 M6(멱등 소비).
- 선행: #239 EventEnvelope(`idempotencyKey`), #243 P0 이벤트소싱+OutboxRelay(at-least-once), #244 P1a BaseConsumer 재시도+DLQ.

## 1. 문제 & 목표

P0 OutboxRelay와 Redis Streams 재전달(XAUTOCLAIM)은 **at-least-once**다. 같은 논리 메시지가 두 번 전달될 수 있다:

- OutboxRelay가 `xadd` 후 `published_at` 갱신 전에 크래시 → 재시작 시 같은 이벤트 재발행.
- 소비자가 처리 후 `xack` 전에 죽음 → XAUTOCLAIM이 같은 스트림 엔트리를 다른 소비자에게 재전달.

핸들러가 비멱등(파일 쓰기·빌드·커밋)이면 중복 전달 = **중복 부작용**. M6의 목표는 소비 시점 dedup으로 at-least-once의 **중복 *전달*을 best-effort로 억제**하는 것이다.

> ⚠️ **정확한 의미**: 이것은 완전한 exactly-once *보장*이 아니다. SETNX는 상호배제 잠금이 아니라 "이 키를 본 적 있는가"의 best-effort 마커다. 주 표적(OutboxRelay 중복발행·정상 핸드오프 후 재전달)에는 사실상 한 번만 처리되지만, **처리 중 크래시** 같은 예외 창에서는 오히려 유실로 기운다(§6). 진정한 exactly-once는 핸들러-내부 트랜잭션 멱등(후속)이 필요하다. `SHARED_IDEMPOTENT_CONSUME=false`로 즉시 비활성화 가능.

**범위**: 7개 에이전트 + (향후) `manager:events` 소비자가 공유하는 `BaseConsumer`에 dedup을 추가한다. P1a와 동일 레이어·additive·가역.

**비범위**: 핸들러-내부 트랜잭션 멱등(부분 실행 후 크래시 복구), 멱등 키 영속 UNIQUE 제약, 전체 봉투(workflow/step/attempt)를 에이전트 메시지에 강제 배선 — 모두 후속(Task Manager P1c/d 및 P0 하드닝).

## 2. 설계 결정 (사용자 승인)

- **범위 = 키-무관 BaseConsumer dedup**. 봉투 전체 배선(7스키마+프로듀서)은 manager↔agent에 workflow/step 모델이 없어 인위적 → Task Manager(P1c/d)로 미룸.
- **플래그 `SHARED_IDEMPOTENT_CONSUME` 기본 ON**. messageId/envelope dedup은 stable·additive·안전. `=false`로 즉시 P1a까지 동작 복원.

## 3. 아키텍처

### 3.1 dedup 지점

`BaseConsumer.handleMessage`의 흐름에 한 단계 삽입:

```
parseOrDlq → [dedupClaim] → dispatchWithRetry → (ackAll)
```

- `parseOrDlq` 성공 후, `dispatchWithRetry`(P1a 재시도 루프) **직전**에 dedup 키를 1회 claim.
- **delivery당 1회** SETNX(attempt당 아님): P1a의 인-프로세스 재시도는 키를 한 번 잡은 채 진행 → dedup의 영향을 받지 않음. dedup은 *별개 delivery*(XAUTOCLAIM 재전달·outbox 중복발행)만 차단.

### 3.2 키 추출 (기본 추출기)

```
key = msg.envelope?.idempotencyKey ?? msg.messageId ?? null
```

- 봉투(`manager:events`)가 있으면 `idempotencyKey`(`workflow:step:attempt`) 우선.
- 없으면(현 에이전트 메시지) 기존 `messageId`(전송별 고유·재전달 시 동일·안정) 폴백.
- 둘 다 없으면 `null` → dedup 건너뛰고 기존대로 처리(하위호환).

### 3.3 Redis dedup 저장

```
SET idem:{stream}:{key} 1 EX {ttlSec} NX   // stream = {streamPrefix}:{sessionId}
```

- **신규(`OK`)** → 키 claim 성공 → `dispatchWithRetry` 진행.
- **중복(`null`)** → 이미 처리(또는 처리 중)된 delivery → `onMessage` 호출 없이 **skip + ack**.
- 키는 성공·DLQ 모두 **유지**(TTL 만료까지) → 중복발행·재전달·DLQ된 poison 재유입을 모두 skip. ⚠️ 이는 향후 **DLQ 재처리 도구**(P1 운영)가 같은 키로 재발행 시 TTL 창 안에서는 조용히 skip됨을 뜻한다 — 재처리 도구는 idem 키를 먼저 삭제해야 한다(후속 추적).
- TTL은 `Math.max(1,·)`로 클램프해 `EX 0`(Redis 거부)을 방지(명시 `ttlSec:0`/음수 방어).
- 네임스페이스 `idem:{stream}:{key}`(stream=`{streamPrefix}:{sessionId}`) — **세션-스트림별 분리**. 중복 delivery는 항상 같은 스트림에 오므로 세션 간 키 충돌(예: messageId 외 키)을 원천 차단.

### 3.4 TTL

- `SHARED_IDEM_TTL_SEC`(기본 `86400`=24h). 최대 재전달 창(XAUTOCLAIM `PENDING_MIN_IDLE_MS` 5분 + outbox 폴링)보다 충분히 길어 정상 중복을 잡고, 무한 증가는 막는다.
- 로컬 양의 정수 파서로 NaN/0/음수는 기본값 폴백(`Number.isFinite && ≥1`).

### 3.5 가역성 & 주입 — 단일 trailing 옵션 객체

현 `BaseConsumer` 생성자는 이미 9개 위치 인자다. dedup 설정을 위치 인자 3개로 더 늘리면 12개가 되어 가독성이 나빠진다. 대신 **단일 trailing 옵션 객체** 하나만 추가한다(P1a `maxDeliveries` 다음, 10번째). 7에이전트 `super(...)`(현 인자 수)는 무영향(회귀 0). 7개 전체 생성자 시그니처를 옵션 객체로 바꾸는 광범위 리팩터는 본 슬라이스 범위 밖.

```ts
constructor(
  ...,                      // 기존 9 인자 (… maxDeliveries 포함)
  dedup: {
    enabled?: boolean;      // 기본 process.env['SHARED_IDEMPOTENT_CONSUME'] !== 'false' (ON)
    ttlSec?: number;        // 기본 SHARED_IDEM_TTL_SEC (86400)
    key?: (msg: TMessage) => string | null; // 기본 추출기(envelope.idempotencyKey ?? messageId)
  } = {},
)
```

- 기본값은 **호출 시점**에 env에서 해석(default param) → 7에이전트는 코드 변경 없이 플래그 적용.
- 테스트는 `dedup` 필드를 명시 주입(env 비의존).

## 4. 데이터 흐름 (시퀀스)

```
정상:        deliver → SETNX(new) → onMessage(성공) → ack          [키 유지]
중복발행:    deliver(2nd) → SETNX(exists) → skip → ack             [onMessage X]
재전달:      crash 후 XAUTOCLAIM → SETNX(exists) → skip → ack       [부작용 1회]
P1a 재시도:  deliver → SETNX(new) → onMessage(실패→재시도→성공) → ack [1 delivery, 키 1회]
플래그 off:  deliver → (dedup 건너뜀) → dispatchWithRetry → ack      [기존 동작]
```

## 5. 에러 처리

- **fail-open**: Redis SETNX 호출이 throw(연결 단절 등)하면 dedup을 건너뛰고 처리를 진행한다. dedup 인프라 장애가 메시지 처리를 막지 않도록 — `BaseConsumer`의 never-throws 계약(배치 비차단)을 보존. 경고 로그.
- skip 경로도 `processMessages`의 `toAck`에 포함 → ack 보장(PEL 누수 0).

## 6. 한계 (문서화·범위 밖)

- **처리 중 크래시 = 무음 유실(중요)**: SETNX로 키를 claim한 뒤 `onMessage` 중 프로세스가 죽으면, 키가 TTL(24h)까지 살아 있어 XAUTOCLAIM 재전달이 그 키를 보고 **skip + ack**한다 → 그 작업 단위는 **영구 유실**(DLQ도, 알림도 없음). **이 시나리오에 한해 M6는 pre-M6보다 나쁘다**: M6 전에는 같은 크래시가 재전달 시 재실행(at-least-once — 부작용 중복이지만 유실 없음)이었으나, M6는 *중복 실행 위험을 무음 유실 위험으로 바꾼다*. 즉 M6는 "중복 *delivery* 억제"이지 핸들러 정확성 장벽이 아니다. 비멱등·치명적 핸들러(파일·빌드·커밋)에는 핸들러-내부 트랜잭션 멱등(또는 실패 시 키 해제)이 진짜 해법이며 **후속(P1 하드닝)**. 그때까지는 `SHARED_IDEMPOTENT_CONSUME=false`로 해당 서비스를 at-least-once로 되돌릴 수 있다.
- 비멱등 핸들러가 첫 attempt에서 부작용 후 throw → P1a 재시도가 부작용 중복(키는 delivery당 1회라 막지 못함). 이는 핸들러 자체 멱등 책임(후속).
- **DLQ 재처리 충돌**: 키가 DLQ 후에도 유지되므로, 운영자가 같은 idempotencyKey로 DLQ 메시지를 TTL 창 안에 재발행하면 라이브 소비자가 조용히 skip한다(재처리 무효·무신호). 후속 DLQ 재처리 도구는 idem 키를 먼저 삭제해야 한다.

## 7. 테스트 (TDD, xzawedShared)

- 신규 delivery: `onMessage` 1회 + `SET ... NX EX` 호출(키·TTL 인자 검증).
- 중복 키 2번째 delivery: `onMessage` 미호출 + ack(skip).
- 키 추출: envelope 우선 → messageId 폴백 → 둘 다 없으면 dedup skip(처리).
- P1a 재시도(핸들러 1회 실패→재시도→성공)는 dedup에 막히지 않음(SETNX delivery당 1회).
- SETNX Redis 오류 → fail-open(처리 계속·throw 없음).
- `dedup.enabled=false`(플래그 off)면 dedup 미동작.
- `dedup.key` 커스텀 추출기 주입 동작.

## 8. 영향 파일

- `xzawedShared/src/streams/base-consumer.ts` — dedup 단계·키 추출·생성자 옵션·env 파싱.
- `xzawedShared/src/__tests__/base-consumer.test.ts` — 위 테스트.
- `xzawedShared/CLAUDE.md` — BaseConsumer 패턴 섹션에 멱등 소비 추가.
- (문서) 루트 `CLAUDE.md` 복원력 사다리/Shared 현황, `docs/senario/HANDOFF.md`(머지 후) 갱신.

## 9. 검증·머지

`cd xzawedShared && pnpm build && pnpm test` + `pnpm audit`. PR → CI(module-boundaries 포함) 그린 → squash 머지 → master 동기화. 이후 HANDOFF·메모리 갱신.
