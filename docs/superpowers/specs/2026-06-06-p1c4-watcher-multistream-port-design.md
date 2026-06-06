# P1c-4 Watcher 다중 스트림 포트화 설계

- 날짜: 2026-06-06
- 서비스: `xzawedShared`(포트 확장) + `xzawedManager`(WatcherEventConsumer)
- 로드맵: senario ROADMAP Phase 1 — P1c "Event Bus 추상화" 소비자 측 잔여(1/2). 5에이전트 설계 패널이 선정한 정석안. [P1c-3 #249] 다음.

## 1. 문제 & 목표

`WatcherEventConsumer`(매니저)는 **다중 스트림** `xreadgroup`(감시 세션마다 스트림 + per-stream `'>'`)을 쓴다. 현 `StreamConsumerPort.readGroup`은 단일 스트림 + `'>'`만 표현해 미적합. 다중 스트림 XREADGROUP은 Redis Streams 1급 fan-in 관용구이고 `RawStreamReply`가 이미 다중 스트림 shape이므로, 포트에 **다중 스트림 읽기 프리미티브를 추가**해 watcher의 전송을 포트로 모은다(P1c "전송 전부 은닉" 완성).

**목표**: `readGroupMulti`를 `StreamConsumerPort`에 **추가**(기존 `readGroup` 보존), WatcherEventConsumer의 다중 `xreadgroup`·per-entry `xack`만 포트로 위임. 회귀 0.

**비범위(의도)**: `_ensureGroups`(swallow-all 정책 — 포트 ensureGroup은 rethrow라 충돌)·`stop()`의 `disconnect()` 생명주기·NOGROUP continue·streams/ids per-loop 스냅샷·sessionId 파싱은 watcher에 잔류. RPC(RedisAgentHandler 등)는 별도 슬라이스(P1c-5 RequestReplyPort).

## 2. 설계 결정 (5에이전트 패널 + 사용자 승인)

- **`readGroupMulti` ADD**(기존 `readGroup` 좁은 단일/'>' 시그니처 보존 → 머지된 3호출자 BaseConsumer·StreamConsumer·SessionGateway 무수정). `readGroup`을 `streams[]`로 일반화(후보 D)는 **기각**(3시그니처 파괴=회귀).
- **transport-only 위임**: `readGroupMulti` + `ack`만. `ensureGroup`은 위임 안 함(swallow 정책 보존).
- **생명주기 잔류**: `disconnect()`+`_redis=null`은 watcher 보유. ⚠️ watcher `disconnect()`는 URL-캐시 공유 클라이언트(StreamConsumer·SessionGateway·RedisAgentHandler 공유)를 끊는 **잠복결함** — 이번 슬라이스는 redis 소유를 watcher에 두고 `readGroupMulti`만 위임해 **결함 확대 0**(전용 인스턴스/ownsRedis 분리는 RPC 슬라이스에서 검토).

## 3. 아키텍처

### 3.1 포트 확장 (`xzawedShared/src/streams/event-bus.ts`)

`StreamConsumerPort`에 추가:
```ts
/** 다중 스트림 xreadgroup '>'(fan-in). ids는 streams와 1:1(watcher는 전부 '>'). 길이 불일치는 throw. */
readGroupMulti(
  streams: string[], group: string, consumer: string,
  ids: string[], opts: { count: number; blockMs: number },
): Promise<RawStreamReply | null>
```
RedisEventBus 구현:
```ts
async readGroupMulti(streams, group, consumer, ids, opts) {
  if (streams.length !== ids.length) {
    throw new Error('readGroupMulti: streams/ids length mismatch')
  }
  return this.redis.xreadgroup(
    'GROUP', group, consumer,
    'COUNT', String(opts.count), 'BLOCK', String(opts.blockMs),
    'STREAMS', ...streams, ...ids,
  ) as unknown as RawStreamReply | null
}
```
- 불변식: `streams.length === ids.length`(누락 시 XREADGROUP STREAMS 파싱 무음 실패 방지). 반환은 기존 `RawStreamReply`(다중 스트림 shape 동일).

### 3.2 WatcherEventConsumer 마이그레이션 (`xzawedManager/.../streams/watcher-event-consumer.ts`)

- `private get bus(): StreamConsumerPort` 추가(`new RedisEventBus(this.redis)`; `stop()`에서 `_bus=null` 리셋 — redis 생명주기 동기).
- `_readOnce`: `this.redis.xreadgroup('GROUP',...,'STREAMS',...streams,...lastIds)` → `this.bus.readGroupMulti(streams, CONSUMER_GROUP, CONSUMER_NAME, lastIds, { count: 50, blockMs: BLOCK_MS })`.
- `_processMessage`: `this.redis.xack(streamKey, CONSUMER_GROUP, msgId)` → `this.bus.ack(streamKey, CONSUMER_GROUP, [msgId])`(스트림키별 분리 호출 — 다중 스트림 id 혼합 금지).
- **불변(잔류)**: `_ensureGroups`(this.redis.xgroup·swallow-all), `stop()`(this.redis.disconnect·_redis=null, + _bus=null 추가), `_loop`·NOGROUP continue·streams/ids 스냅샷·sessionId 파싱.

### 3.3 의존성
- 매니저는 이미 `@xzawed/agent-streams` 의존 → `RedisEventBus`·`StreamConsumerPort` import 허용(M3 무관).

## 4. 회귀 안전성

- 18개 watcher 테스트 mock은 `{xgroup, xreadgroup, xack, disconnect}`(pipeline 없음) → `bus.ack([id])`는 개별 `redis.xack` 폴백 → `xack(streamKey, group, '1-0')` 단언 **바이트 동일**. `xreadgroup` mock은 인자 무시(call-count 기반) → 다중 인자 변경 무영향. `_ensureGroups`·NOGROUP·BUSYGROUP·disconnect·제어흐름 전부 불변 → 18 테스트 보존. 매니저 375 회귀 확증.
- ack는 per-stream(엔트리가 온 streamKey)로 호출 — 잘못된 스트림 ack(PEL 누수) 방지(현 per-entry 구조 유지).

## 5. 테스트 (TDD)

- **포트 단위(event-bus.test.ts)**: `readGroupMulti`가 `xreadgroup('GROUP',g,c,'COUNT','50','BLOCK','3000','STREAMS',s1,s2,'>','>')`로 호출·raw 반환·null 패스스루; `streams.length!==ids.length`면 throw.
- **watcher 18테스트**: bus 위임 후 전부 통과(회귀 0).

## 6. 영향 파일

- **수정**: `xzawedShared/src/streams/event-bus.ts`(+`__tests__/event-bus.test.ts`), `xzawedManager/.../streams/watcher-event-consumer.ts`, `xzawedShared/CLAUDE.md`·`xzawedManager/CLAUDE.md`.

## 7. 검증·머지

`cd xzawedShared && pnpm build && pnpm test` + 매니저 `pnpm build && pnpm test`(375) + audit + 루트 jscpd. 적대적 리뷰(다중 스트림 인자·ack per-stream·생명주기 잠복결함 미확대). PR → CI 그린 → squash 머지. HANDOFF·메모리 갱신.
