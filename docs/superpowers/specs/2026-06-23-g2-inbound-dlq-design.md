# G2 — 인바운드 소비자 DLQ 격리 설계

- 날짜: 2026-06-23
- 상태: 승인됨 (구현 대기)
- 범위: xzawedShared(`dlq.ts`·`base-consumer.ts`) + xzawedManager(`streams/consumer.ts`·`watcher-event-consumer.ts`·`session-gateway.ts`)

## 1. 배경·문제

xzawedManager의 **내부** 소비자(decision/decomposition/release/oracle/risk/worker)는 전부 `BaseConsumer`를 상속해 **바운드 재시도 + DLQ 격리**(poison 메시지를 `{stream}:dlq`로 격리·운영자 가시성·`redriveDlq` 재처리)를 갖는다. 그러나 **인바운드(정문)** 메시지를 받는 3개 소비자는 `BaseConsumer`를 쓰지 않고 손으로 짠 `parse→ack` 루프라 DLQ가 **전혀 없다** — 스키마/JSON 무효 메시지와 핸들러 throw가 **무음 ack-drop**된다.

| 소비자 | 스트림 | 현재 결함 |
|---|---|---|
| `StreamConsumer` (`consumer.ts`) | `orchestrator:to-manager:{sessionId}` (task_request·decompose_request·info_response·abort) | `parseMessage` JSON/스키마 실패 → `console.error`+ack(핸들러 미실행). 핸들러 throw → `console.error`+`finally` ack. DLQ·재시도·재처리 0 |
| `WatcherEventConsumer` (`watcher-event-consumer.ts`) | `watcher:to-manager:{sessionId}` (다중 스트림·readGroupMulti) | `_processMessage` `try{parse+onFileChanged}catch{ /*무시*/ }finally{ack}`. 격리 0 |
| `SessionGatewayConsumer` (`session-gateway.ts`) | `orchestrator:to-manager:sessions` | 인라인 `try{parse sessionId + onSessionInit}catch{skip}finally{ack}`. 격리 0 |

**영향**: 가장 중요한 작업 ingress(orchestrator→manager `task_request`/`decompose_request`)가 스키마 검증 실패 또는 핸들러 throw 시 메시지를 조용히 잃는다 — 격리·재처리·운영자 가시성 없음. 내부 파이프라인은 하드닝됐으나 **정문은 비대칭으로 무방비**다. (post-#332 재감사 g2·완성도 비평이 Watcher·Gateway도 미커버 인바운드로 확인.)

## 2. 목표·비목표

**목표**: 3개 인바운드 소비자에 내부 소비자와 동등한 DLQ 격리를 부여 — poison/handler-throw 메시지를 무음 drop 대신 `{stream}:dlq`로 격리해 운영자 가시성 + 기존 `redriveDlq` 재처리 가능하게.

**비목표(YAGNI·후속)**:
- 인바운드 핸들러의 바운드 재시도(아래 결정 1: 없음).
- 인바운드 소비자의 멱등 소비(SETNX dedup) — 이들은 마커를 설정하지 않으며, `redriveDlq`의 마커 선삭제는 인바운드에 무해한 no-op(아래 §6).
- `task_request`의 앱 레벨 requester-error 발행 경로 변경(`sessions.route.ts`가 자체 try/catch로 처리·불변).
- Orchestrator(별도 스택) 변경 — 없음.
- 신규 운영 라우트 — `POST /api/admin/dlq/redrive`가 이미 임의 스트림 redrive를 지원(인증 필수).

## 3. 결정(승인됨)

1. **재시도 정책 = 없음**. BaseConsumer는 `handler_failed`를 `maxDeliveries`회 재시도하나, 인바운드 핸들러는 **비멱등·장기**(`task_request`=세션 tool-loop 시작·`onFileChanged`=리빌드·`onSessionInit`=세션 등록)라 재시도가 부수효과를 재발화시킨다. 즉시 DLQ(`handler_failed`·attempts=1).
2. **게이팅 = 무조건(신규 flag 0)**. BaseConsumer DLQ가 무조건 켜진 것과 일관·strictly safer(drop→격리)·DLQ 발행 실패 시 ack 폴백(비차단). 회귀 위험 없음(현재 drop을 격리로 대체).
3. **범위 = 인바운드 3개 전부**.

## 4. 아키텍처

### 4.1 shared — DLQ 쓰기 경로 단일출처 추출 (`xzawedShared/src/streams/dlq.ts`)

`BaseConsumer`의 private `routeToDlq`를 `dlq.ts`의 **export 순수-위임 함수**로 추출한다(이미 `dlqStreamKey`·`idemKey`·`defaultDedupKey`가 단일출처인 모듈 — DLQ **쓰기** 경로도 여기로 통합해 드리프트 0·CPD 0). `dlq.ts`는 `base-consumer`를 import하지 않으므로(순환 회피) 의존 방향 유지.

```ts
/** DLQ 발행에 필요한 최소 publisher 인터페이스(EventBus/StreamConsumerPort 충족·테스트 주입 용이). */
export interface DlqPublisher {
  publish(stream: string, message: unknown, opts?: { maxlen?: number }): Promise<unknown>
}

/** DLQ approximate MAXLEN(무한 증가 방지). base-consumer가 재사용. */
export const DLQ_MAXLEN = 1000

/**
 * poison 메시지를 `{stream}:dlq`로 격리한다(DlqMessage 봉투 발행).
 * 페이로드 구성·발행 실패는 모두 경고 후 무시(배치 비차단·never-throw) — 격리 best-effort.
 * error 코어션도 try 안에서(병리적 throwing getter가 계약을 깨지 않도록).
 */
export async function routeToDlq(
  publisher: DlqPublisher,
  stream: string,
  raw: string,
  reason: DlqReason,
  attempts: number,
  error?: unknown,
): Promise<void> {
  try {
    const dlqMessage = {
      original: raw, reason, attempts,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
      failedAt: Date.now(), sourceStream: stream,
    }
    await publisher.publish(dlqStreamKey(stream), dlqMessage, { maxlen: DLQ_MAXLEN })
  } catch (e) {
    console.error(`[dlq] DLQ 발행 실패(${dlqStreamKey(stream)}) — 메시지 격리 실패:`, e)
  }
}
```

`DlqMessage` 봉투 shape는 기존 `DlqMessageSchema`(original·reason·attempts·error?·failedAt·sourceStream)와 동일 — `redriveDlq`가 그대로 파싱·재처리.

### 4.2 shared — BaseConsumer 리팩터 (`base-consumer.ts`)

private `routeToDlq` 본문을 공유 함수 호출로 교체(시그니처·호출부 불변·**동작 바이트 동일**):

```ts
private async routeToDlq(stream: string, raw: string, reason: DlqReason, attempts: number, error?: unknown): Promise<void> {
  await routeToDlq(this.bus, stream, raw, reason, attempts, error)  // 공유 함수 위임
}
```

`DLQ_MAXLEN` 로컬 상수는 제거하고 `dlq.ts`에서 import(단일출처). 기존 base-consumer 테스트는 전부 통과(리팩터·회귀 0).

### 4.3 Manager — 인바운드 배선

세 소비자가 모두 생성자에서 `RedisEventBus`(`this.bus`)를 보유하므로 `this.bus`를 `DlqPublisher`로 그대로 사용(추가 의존 0).

#### StreamConsumer (`consumer.ts`)
`parseMessage`/`processEntry`를 재구성해 **구조적 skip vs invalid_schema DLQ**를 구분하고 raw를 핸들러 throw DLQ에 전달:
- raw 추출: `data` 필드 없음·undefined → ack-skip(구조적·DLQ 아님·BaseConsumer `parseOrDlq`와 동일).
- JSON.parse / `OrchestratorToManagerMessageSchema.safeParse` 실패 → `routeToDlq(bus, stream, raw, 'invalid_schema', 0)` 후 ack.
- 유효 → 핸들러 호출. throw 시 → `routeToDlq(bus, stream, raw, 'handler_failed', 1, err)` 후 ack(**재시도 없음**).
- ⚠️ `task_request` 핸들러(`sessions.route.ts`)는 자체 try/catch로 에러를 requester에게 발행하고 **rethrow하지 않으므로** processEntry catch에 도달하지 않음 → `task_request` 정상 에러는 이중 DLQ 안 됨(`handler_failed` DLQ는 실제로 throw하는 분기에만). `invalid_schema` DLQ는 앱 핸들러를 우회하던 malformed 메시지를 처음으로 격리(핵심 가치).

#### WatcherEventConsumer (`watcher-event-consumer.ts`)
`_processMessage`의 단일 try를 분리:
- `data` 필드 없음 → ack-skip.
- `JSON.parse` 실패 → `routeToDlq(bus, streamKey, raw, 'invalid_schema', 0)` 후 ack.
- 파싱 OK이나 `type !== 'file_changed'` → ack-skip(poison 아님·정상 무관 메시지).
- `onFileChanged` throw → `routeToDlq(bus, streamKey, raw, 'handler_failed', 1, err)` 후 ack.

#### SessionGatewayConsumer (`session-gateway.ts`)
인라인 처리 분리:
- `data` 필드 없음 → ack-skip.
- `JSON.parse` 실패 → `routeToDlq(bus, GATEWAY_STREAM, raw, 'invalid_schema', 0)` 후 ack.
- `sessionId`가 uuid 아님 → ack-skip(소프트 검증·현재 동작 보존·poison으로 보지 않음).
- `onSessionInit` throw → `routeToDlq(bus, GATEWAY_STREAM, raw, 'handler_failed', 1, err)` 후 ack.

## 5. 데이터 흐름

```
poison/throw 인바운드 메시지
  → routeToDlq(bus, sourceStream, raw, reason, attempts)
  → bus.publish(`${sourceStream}:dlq`, DlqMessage, {maxlen:1000})
  → ack(원 스트림에서 제거·PEL 누수 0)
  ── 운영자 ──> POST /api/admin/dlq/redrive { stream: sourceStream, reason? }
  → redriveDlq → 원 스트림 재발행 → 소비자 재처리
```

## 6. 에러 처리·엣지

- **DLQ 발행 실패**: `routeToDlq`가 삼킴(console.error)+호출부가 ack 진행 → 메시지는 PEL에서 제거(격리는 best-effort·BaseConsumer와 동일). 발행 실패가 루프를 막지 않음.
- **redrive 마커 선삭제**: `redriveDlq`는 재발행 전 `idem:{stream}:{key}` 마커를 삭제하나, 인바운드 소비자는 SETNX 마커를 설정하지 않으므로 존재하지 않는 키의 `del`은 **무해한 no-op**. redrive는 마커 없이도 정상 동작(`original`+`sourceStream`만으로 재발행).
- **`never-throw` 보존**: 세 소비자의 기존 xreadgroup 루프 try/catch·`finally ack`는 불변 — DLQ 라우팅은 ack 이전에 끼워넣고 자체 never-throw라 루프 안정성 유지.

## 7. 테스트

- **shared `__tests__/dlq.test.ts`**: export `routeToDlq` — (a) 올바른 `DlqMessage`(original·reason·attempts·error·failedAt·sourceStream)를 `{stream}:dlq`로 `maxlen` 동반 발행, (b) `error` 미지정 시 키 부재, (c) publisher.publish reject 시 throw 안 함(삼킴). `DLQ_MAXLEN` export 확인.
- **shared `base-consumer.test.ts`**: 기존 DLQ 테스트(invalid_schema·handler_failed 격리) 전부 통과(리팩터 회귀 0).
- **Manager `consumer.test.ts`**: invalid JSON/스키마 → `bus.publish({stream}:dlq, …invalid_schema)` 호출 + ack / 핸들러 throw → `…handler_failed` 발행 + ack(재시도 없음·정확히 1회) / 구조적(data 없음) → ack-skip·DLQ 미발행.
- **Manager `watcher-event-consumer.test.ts`**: JSON 실패 → invalid_schema DLQ / `onFileChanged` throw → handler_failed DLQ / non-file_changed → skip.
- **Manager `session-gateway.test.ts`**: JSON 실패 → invalid_schema DLQ / `onSessionInit` throw → handler_failed DLQ / non-uuid sessionId → skip.

## 8. 수용 기준

1. 3개 인바운드 소비자의 JSON/스키마 무효 메시지가 `{stream}:dlq`로 격리되고 ack된다(무음 drop 0).
2. 3개 인바운드 핸들러 throw가 `{stream}:dlq`로 격리되고 ack된다(재시도 없음·attempts=1).
3. 구조적 결함·정상 무관 메시지·소프트 검증 실패는 격리 없이 ack-skip(현재 동작 보존).
4. `routeToDlq`가 shared 단일출처이고 BaseConsumer가 이를 재사용(jscpd 0 클론).
5. BaseConsumer 동작 회귀 0(기존 테스트 통과)·신규 flag 0·migration 0.
6. `POST /api/admin/dlq/redrive`로 인바운드 DLQ 스트림 재처리 가능(기존 도구 재사용·코드 변경 0).

## 9. 영향 파일

- `xzawedShared/src/streams/dlq.ts` (+`routeToDlq`·`DlqPublisher`·`DLQ_MAXLEN` export), `src/index.ts`(배럴 export), `src/streams/base-consumer.ts`(리팩터), `src/__tests__/dlq.test.ts`.
- `xzawedManager/packages/server/src/streams/{consumer,watcher-event-consumer,session-gateway}.ts` + 각 `.test.ts`.
- 문서: 작업 완료 후 CLAUDE.md(루트·Manager·Shared) 최신화.
