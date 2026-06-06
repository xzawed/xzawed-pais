# P1c-2 소비 전송 포트 추상화 설계

- 날짜: 2026-06-06
- 서비스: `xzawedShared`(`@xzawed/agent-streams`)
- 로드맵: senario ROADMAP Phase 1 — P1c "Event Bus 추상화"의 **두 번째(소비자) 슬라이스**. [P1c-1 퍼블리셔 #247] 다음.

## 1. 문제 & 목표

`BaseConsumer`(7에이전트 공유)가 소비 전송을 Redis Streams에 직결한다: `xgroup`(그룹 생성)·`xreadgroup`(읽기)·`xack`(+pipeline 배치)·`xautoclaim`(reclaim)·DLQ `xadd`. P1c-1이 발행을 `EventBus` 뒤로 모은 것처럼, **소비 전송도 같은 추상화 뒤로** 모은다(전송계층 교체·테스트 가능화, 일관성).

**목표**: BaseConsumer의 소비 전송 4-op + DLQ를 `StreamConsumerPort`(EventBus 확장) 뒤로 위임. **오케스트레이션(루프·dedup·재시도·DLQ 판정·never-throws·배치 ack 수집)은 전부 BaseConsumer에 유지**. 회귀 0 최우선.

**범위**: `xzawedShared` `BaseConsumer` + `event-bus.ts`. 7에이전트는 `BaseConsumer` 생성자 시그니처 불변이라 **무변경**.

**비범위(의도적)**:
- dedup `set`(SET NX EX) — 멱등 claim은 *소비 로직*이지 전송이 아님. raw redis 유지(후속 정리 가능).
- `close()`의 `quit()` — 생명주기. raw redis 유지.
- 매니저 자체 컨슈머(StreamConsumer·SessionGateway·WatcherEventConsumer·SessionDispatcher)·RedisAgentHandler 요청-응답 — 후속 슬라이스.

## 2. 설계 결정 (사용자 승인)

- **소비 전송 포트 추상화**: 4-op(ensureGroup/readGroup/ack/autoclaim) + DLQ는 `EventBus.publish` 재사용.
- **반환은 현 Redis raw shape 그대로** → BaseConsumer 파싱 불변(회귀 0).
- **BaseConsumer 생성자 시그니처 불변** — 내부에서 `RedisEventBus`를 만들어 위임. 7에이전트 무변경.

## 3. 아키텍처

### 3.1 인터페이스 (`xzawedShared/src/streams/event-bus.ts` 확장)

```ts
/** xreadgroup/xautoclaim의 ioredis raw 응답(스트림→[id, fields[]] 목록). */
export type RawStreamReply = [string, [string, string[]][]][]

/** 소비 전송 포트. EventBus(publish)를 상속 — DLQ 발행에 publish 재사용. */
export interface StreamConsumerPort extends EventBus {
  /** xgroup CREATE(MKSTREAM). BUSYGROUP은 무시, 그 외 오류는 전파. */
  ensureGroup(stream: string, group: string): Promise<void>
  /** xreadgroup '>' (신규 메시지). raw 응답 또는 null(타임아웃). */
  readGroup(stream: string, group: string, consumer: string, opts: { count: number; blockMs: number }): Promise<RawStreamReply | null>
  /** xack — pipeline 배치(미지원 시 개별 폴백). */
  ack(stream: string, group: string, ids: string[]): Promise<void>
  /** xautoclaim — 미처리(idle) 메시지 재획득. ioredis raw 응답([cursor, messages, deleted]). */
  autoclaim(stream: string, group: string, consumer: string, opts: { minIdleMs: number; count: number }): Promise<unknown>
}
```

### 3.2 RedisEventBus 구현(추가 메서드)

기존 `redis.xgroup/xreadgroup/xack/xautoclaim/pipeline` 호출을 **인자·동작 동일**하게 옮긴다(현 BaseConsumer에서 그대로 이동):

```ts
async ensureGroup(stream, group) {
  try { await this.redis.xgroup('CREATE', stream, group, '$', 'MKSTREAM') }
  catch (e) { if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e }
}
async readGroup(stream, group, consumer, { count, blockMs }) {
  return this.redis.xreadgroup('GROUP', group, consumer, 'COUNT', String(count), 'BLOCK', String(blockMs), 'STREAMS', stream, '>') as Promise<RawStreamReply | null>
}
async ack(stream, group, ids) {
  if (typeof this.redis.pipeline === 'function') {
    const p = this.redis.pipeline()
    for (const id of ids) p.xack(stream, group, id)
    await p.exec(); return
  }
  for (const id of ids) await this.redis.xack(stream, group, id)
}
async autoclaim(stream, group, consumer, { minIdleMs, count }) {
  return this.redis.xautoclaim(stream, group, consumer, minIdleMs, '0-0', 'COUNT', String(count))
}
```

### 3.3 BaseConsumer 마이그레이션

- 생성자 body에 `this.bus = new RedisEventBus(this.redis)` 추가(시그니처·`redis` 필드 불변).
- 전송 호출 위임:
  - `ensureGroup()` 내부 try/catch xgroup → `await this.bus.ensureGroup(stream, this.consumerGroup)`.
  - `readOnce`의 `xreadgroup(...)` → `this.bus.readGroup(stream, this.consumerGroup, this.consumerName, { count: 10, blockMs: 1000 })`.
  - `claimPendingMessages`의 `xautoclaim(...)` → `this.bus.autoclaim(stream, this.consumerGroup, this.consumerName, { minIdleMs: PENDING_MIN_IDLE_MS, count: PENDING_CLAIM_COUNT })`.
  - `ackAll`의 pipeline/xack → `this.bus.ack(stream, this.consumerGroup, ids)`.
  - `routeToDlq`의 `xadd(\`${stream}:dlq\`, 'MAXLEN','~',DLQ_MAXLEN,'*','data', JSON.stringify(obj))` → **객체를 그대로** `this.bus.publish(\`${stream}:dlq\`, obj, { maxlen: DLQ_MAXLEN })`. ⚠️ **이중 직렬화 방지**: publish가 `JSON.stringify`하므로 routeToDlq의 수동 `JSON.stringify`를 제거하고 객체를 넘긴다(와이어 바이트 동일).
- **유지(raw redis)**: `isDuplicate`의 `this.redis.set(...)`(dedup), `close()`의 `this.redis.quit()`.
- 오케스트레이션(handleMessage·parseOrDlq·dispatchWithRetry·processMessages·never-throws·DLQ 판정)은 그대로.

### 3.4 의존성·경계

- `base-consumer.ts`가 같은 패키지 `./event-bus.js`를 import(순환 없음 — event-bus는 ioredis 타입만 의존). M3 무관(패키지 내부).

## 4. 데이터 흐름

```
start → bus.ensureGroup → (loop) bus.readGroup → processMessages
         → handleMessage[parseOrDlq → isDuplicate(raw set) → dispatchWithRetry → routeToDlq(bus.publish)]
         → bus.ack(수집 ids)
claimPendingMessages(시작 1회) → bus.autoclaim → processMessages
close() → redis.quit()(raw, ownsRedis 시)
```

## 5. 에러 처리

- 위임은 동작 보존: ensureGroup BUSYGROUP 무시·그 외 전파, readGroup 오류는 BaseConsumer의 `handleReadError`(NOGROUP 재생성·백오프)가 처리(불변), DLQ 발행 실패는 routeToDlq의 try/catch가 흡수(불변·비차단), ack는 finally에서(불변).
- never-throws 계약·PEL 누수 0·배치 비차단 모두 BaseConsumer에 유지.

## 6. 테스트 (TDD, xzawedShared)

- **포트 단위 테스트**(event-bus.test.ts): ensureGroup이 xgroup CREATE 호출·BUSYGROUP 무시·그 외 전파, readGroup 인자(GROUP/COUNT/BLOCK/STREAMS/'>'), ack pipeline 배치 + pipeline 미지원 폴백, autoclaim 인자(minIdleMs/'0-0'/COUNT).
- **BaseConsumer 기존 122(=shared 전체) 테스트 전부 통과**: redis mock이 bus 경유로 동일 호출되므로 xgroup/xreadgroup/xack/xautoclaim/xadd(DLQ)/set 단언 불변. DLQ payload 단언(reason·attempts·original·error·failedAt·sourceStream)도 publish 경유 후 동일.
- 7에이전트 회귀 0(생성자 불변).

## 7. 영향 파일

- **수정**: `xzawedShared/src/streams/event-bus.ts`(포트 4-op + 타입), `xzawedShared/src/streams/base-consumer.ts`(위임), `xzawedShared/src/index.ts`(`StreamConsumerPort`·`RawStreamReply` export), `xzawedShared/src/__tests__/event-bus.test.ts`(포트 테스트), `xzawedShared/CLAUDE.md`, 루트 `CLAUDE.md`(테스트 수).

## 8. 검증·머지

`cd xzawedShared && pnpm build && pnpm test` + 7에이전트 회귀(빌드·테스트) + `pnpm audit` + 루트 jscpd. **BaseConsumer 핵심 변경이므로 적대적 리뷰(Workflow) 강하게**. PR → CI 그린 → squash 머지. 이후 HANDOFF·메모리 갱신.
