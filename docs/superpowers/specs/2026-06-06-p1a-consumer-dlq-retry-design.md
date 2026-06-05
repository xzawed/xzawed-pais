# P1a — BaseConsumer 바운드 재시도 + DLQ

- 작성: 2026-06-06
- 상태: 설계 승인됨 → 구현 계획(writing-plans) 대기
- 원천: senario `ROADMAP.md` Phase 1(복원력 사다리), `xzawedPAIS_handoff_spec.md` §12(에스컬레이션 사다리 5단 '격리: poison N회 후 DLQ')
- 브랜치: `feat/shared/consumer-dlq-retry` (master d5381b1 분기)

## 1. 배경과 목표

### 현재 문제 (`xzawedShared base-consumer.ts`)
7개 에이전트(planner·developer·designer·tester·builder·watcher·security)가 상속하는 `BaseConsumer<T>`는 poison 메시지(핸들러가 throw하는 메시지)를 안전하게 처리하지 못한다:
- `processMessages`가 `try { await onMessage } finally { toAck.push }` — **핸들러가 throw해도 ack**(메시지 드롭·손실). 동시에 throw가 전파돼 `readOnce` catch로 가 **배치 나머지가 미처리**(다음 XAUTOCLAIM까지 대기).
- `claimPendingMessages`(XAUTOCLAIM)는 **시작 시 1회만** 호출 — running 중 PEL에 남은 메시지는 재시작 전까지 reclaim 안 됨.
- 컨슈머를 죽이는 메시지(ack 전 死)는 재시작마다 XAUTOCLAIM reclaim → **무한 루프 가능**(poison 상한 없음).

결과: poison 메시지가 **조용히 손실**되거나 **무한 재시도**된다. senario §12 사다리 5단(격리)이 부재.

### 목표
복원력 사다리의 **'격리'(poison N회 후 DLQ)** 를 BaseConsumer에 추가한다.
- 핸들러 실패 메시지를 **바운드 재시도**(N회) 후 **DLQ 스트림으로 격리**(손실·무한루프 방지).
- 스키마 무효/malformed는 비재시도성 → **즉시 DLQ**(현재 조용한 드롭 → 보존).
- 배치 비차단(한 poison이 나머지를 막지 않음)·PEL 누수 0.
- 7개 에이전트에 **공통 적용**(서비스별 코드 변경 0 — 기본값 동작).

## 2. 범위

### 포함 (확정)
- `BaseConsumer`에 인프로세스 바운드 재시도 + DLQ 라우팅.
- `maxDeliveries`(기본 3) 생성자 파라미터(기존 인스턴스는 기본값).
- DLQ 스트림 `{streamPrefix}:{sessionId}:dlq`.

### 비범위 (후속)
- **Manager `StreamConsumer`**(별개 클래스, BaseConsumer 미상속) DLQ — 동일 패턴 fast-follow(별 PR).
- **OutboxRelay DLQ** — 전송 실패는 transient(Redis down)라 at-least-once 재시도가 적절. 별개.
- **DLQ 재처리·검사 도구·알림** — P1 운영.
- **멱등 소비(M6)·lease 명시화·Task Manager** — P1b/P1d.

## 3. 접근 — 인프로세스 바운드 재시도 (승인됨)

핸들러 실패 시 같은 메시지를 `maxDeliveries`회까지 짧은 백오프로 즉시 재시도하고, 소진 시 DLQ로 보낸 뒤 ack한다. 대안(don't-ack + XAUTOCLAIM reclaim)은 재시도 지연이 min-idle(5분)이고 루프 내 주기적 XAUTOCLAIM이 필요해 비채택. 인프로세스는 자기완결·빠른 재시도(transient 친화)·배치 비차단.

> XAUTOCLAIM(컨슈머 死 복구)은 **그대로 유지** — 시작 시 reclaim된 메시지도 동일 `handleMessage` 경로(재시도+DLQ)를 거친다.

## 4. 동작·데이터 흐름

```
메시지 수신(XREADGROUP '>' 또는 XAUTOCLAIM reclaim)
  → handleMessage(msgId, raw):
      parse/validate 실패 → routeToDlq(raw, 'invalid_schema') → (ack)
      유효 → for attempt in 1..maxDeliveries:
                try onMessage(parsed) → 성공 → return (ack)
                catch → attempt < max면 백오프 후 재시도, max면 routeToDlq(parsed, 'handler_failed', error) → return (ack)
  → 모든 메시지 ack (handleMessage는 throw 안 함 → 배치 비차단·PEL 누수 0)
```

- **재시도 백오프**: 주입된 `sleep`로 `min(2^(attempt-1) * baseMs, cap)`(예 base 500ms). 첫 시도는 즉시.
- **ack 정책**: 성공·DLQ(소진)·DLQ(무효) 모두 terminal → ack. 컨슈머가 `handleMessage` 도중 死하면 PEL 잔류 → 다음 시작 시 XAUTOCLAIM reclaim → 재시도(동일 경로).

## 5. DLQ 스트림
- 키: `{streamPrefix}:{sessionId}:dlq` (원본 스트림 옆, 세션 컨텍스트 보존).
- 페이로드(`data` 필드, 기존 컨벤션): `{ original: <raw string>, reason: 'handler_failed'|'invalid_schema', attempts: number, error?: string, failedAt: number, sourceStream: string }`.
- DLQ XADD 자체가 실패해도(Redis 일시 장애) `handleMessage`는 throw하지 않고 경고 로그 후 진행(배치 비차단). 해당 메시지는 ack — 손실 위험은 있으나 DLQ 발행 실패는 드물고, 강한 보장(DLQ도 outbox화)은 후속.

## 6. 컴포넌트
- **`xzawedShared/src/streams/base-consumer.ts`**:
  - 생성자에 `maxDeliveries = 3` 파라미터 추가(기존 위치 호환 — `ownsRedis` 다음 또는 옵션).
  - `processMessages`를 per-message `handleMessage` 호출로 재구성(throw 비전파).
  - `private async handleMessage(stream, msgId, fields): Promise<void>` — parse→retry→DLQ. 항상 정상 반환.
  - `private async routeToDlq(stream, payload, reason, attempts, error?): Promise<void>` — `{stream}:dlq`에 XADD. 실패 시 경고 로그.
- 7개 에이전트 `consumer.ts`(`extends BaseConsumer`)는 변경 없음(기본 `maxDeliveries=3`).

## 7. 테스트 (TDD, `base-consumer.test.ts` mock redis)
- 핸들러 성공 → onMessage 1회·ack·DLQ XADD 없음.
- 핸들러 영구 실패 → onMessage `maxDeliveries`회 호출·DLQ XADD 1회(`reason:'handler_failed'`·attempts)·원본 ack.
- 일시 실패 후 성공(2번째 시도 성공) → DLQ 없음·ack·onMessage 2회.
- 스키마 무효 → onMessage 0회·DLQ XADD 1회(`reason:'invalid_schema'`)·ack.
- poison이 배치 중간에 있어도 나머지 메시지 처리·전부 ack(비차단).
- DLQ XADD 실패해도 throw 없이 배치 계속.
- `maxDeliveries` 파라미터 동작(예 1이면 재시도 없이 즉시 DLQ).

## 8. 가역성·영향
- 기존 동작 대비 변화: poison 메시지가 (ack-drop) 대신 (재시도→DLQ)로 격리됨 — 손실 방지·관측 가능. 정상 메시지 경로는 불변(성공 1회→ack).
- 추가 Redis 키: DLQ 스트림(세션별, 발행 시에만 생성). 인메모리·DB 변경 없음. feature-flag 불필요(개선이 순방향·안전).
- 7개 에이전트 빌드 전 `xzawedShared` 선빌드 필수(기존 gotcha).
