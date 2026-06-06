# P1c-5 RequestReplyPort — RPC 요청-응답 추상화 설계

- 날짜: 2026-06-06
- 서비스: `xzawedShared`(포트) + `xzawedManager`(RedisAgentHandler·switch-project·register-project)
- 로드맵: senario ROADMAP Phase 1 — P1c "Event Bus 추상화" 소비자 측 잔여(2/2). 5에이전트 설계 패널 정석안. [P1c-4 #251] 다음. 이후 P1d Task Manager.

## 1. 문제 & 목표

매니저의 3개 핸들러가 **요청-응답 RPC**를 Redis Streams에 직결한다: `xrevrange`(응답 스트림 tip 캡처) → `xadd`(요청 발행) → **비그룹 `xread` BLOCK 폴링**(응답 대기, deadline). 이는 consumer-group 소비(ack/PEL)와 **직교**하므로 `StreamConsumerPort`/`EventBus`에 넣으면 ISP/LSP 위반(패널 만장일치). 별도 `RequestReplyPort`로 분리해 3복제의 전송 프리미티브를 통일한다.

**대상 3사이트**:
- `RedisAgentHandler`(도구 디스패치 — 매니저→7에이전트 **핵심경로**): getStreamTip(xrevrange)·publishRequest(xadd)·execute의 xread.
- `switch-project`·`register-project`(프로젝트 RPC, ~95% 중복): xrevrange tip→xadd→xread 폴.

**비범위(의도)**:
- RedisAgentHandler `ensureSessionStream`(xgroup 그룹 셋업 — RPC 아님)·`notifyGateway`(게이트웨이 ping) → raw 잔류(후속).
- lease/visibility-timeout/멱등키(attempt_id) → P1d 본체(seam만).
- switch/register 루프 구조 중복 완전 제거 → 별건(기존 clone).

## 2. 설계 결정 (5에이전트 패널 + 사용자 승인)

- **별도 `RequestReplyPort extends EventBus`**(그룹 소비와 직교 — 같은 포트 금지). `RedisEventBus`가 구현(이미 EventBus·StreamConsumerPort 구현 → 한 어댑터가 전 포트).
- **RPC 라운드트립만 위임**(streamTip·publish·readFrom). RedisAgentHandler 핵심경로 churn 최소.

## 3. 아키텍처

### 3.1 포트 (`xzawedShared/src/streams/event-bus.ts`)

```ts
/** 요청-응답(RPC) 전송 포트. 그룹 소비와 직교(비그룹 xread + tip 상관). publish(요청 xadd)는 EventBus 상속. */
export interface RequestReplyPort extends EventBus {
  /** 응답 스트림의 최신 엔트리 ID(xrevrange COUNT 1). 비었으면 '0-0'. publish 전 캡처용. */
  streamTip(stream: string): Promise<string>
  /** 비그룹 xread BLOCK(fromId 이후). raw 응답 또는 null(타임아웃). */
  readFrom(stream: string, fromId: string, opts: { count: number; blockMs: number }): Promise<RawStreamReply | null>
}
```
RedisEventBus 구현:
```ts
async streamTip(stream) {
  const tip = await this.redis.xrevrange(stream, '+', '-', 'COUNT', '1') as [string, string[]][]
  return tip[0]?.[0] ?? '0-0'
}
async readFrom(stream, fromId, opts) {
  return this.redis.xread('COUNT', String(opts.count), 'BLOCK', String(opts.blockMs), 'STREAMS', stream, fromId) as unknown as RawStreamReply | null
}
```

### 3.2 마이그레이션

**switch-project·register-project** (동일 패턴):
- `const redis = getRedisClient(url)` → `const bus = new RedisEventBus(getRedisClient(url))`.
- `redis.xrevrange(responseStream,'+','-','COUNT','1')` + tip 추출 → `await bus.streamTip(responseStream)`.
- 요청 `redis.xadd(REQUEST_STREAM,'*','data',JSON.stringify(req))` → `await bus.publish(REQUEST_STREAM, req)`.
- 폴 루프 `redis.xread('COUNT','5','BLOCK',blockMs,'STREAMS',responseStream,lastId)` → `await bus.readFrom(responseStream, lastId, { count: 5, blockMs })`.
- 루프·deadline(30s)·`ProjectResponseSchema`/`SwitchOutputSchema`/`RegisterOutputSchema` 파싱·도메인 검증·에러 분기 **불변**.

**RedisAgentHandler**(인스턴스 `private bus` — 기존 lazy `get redis()` 위에 `RedisEventBus`):
- `getStreamTip`: `xrevrange` → `bus.streamTip(responseStream)`.
- `publishRequest`: 요청 `xadd` → `bus.publish(requestStream, message)`(payload·userContext 합성 동일).
- `execute` 폴 루프: `xread('COUNT','10','BLOCK',blockMs,'STREAMS',responseStream,lastId)` → `bus.readFrom(responseStream, lastId, { count: 10, blockMs })`.
- **잔류(raw)**: `ensureSessionStream`(xgroup CREATE+BUSYGROUP)·`notifyGateway`(xadd). handleMessage·processStreamResults·deadline(120s)·**tip-BEFORE-send 레이스 윈도우**(getStreamTip을 publishRequest 전에 호출)·`_notifiedSessions`·agent_query/clarification/error 분기 **전부 보존**.

### 3.3 의존성
- 매니저는 이미 `@xzawed/agent-streams` 의존 → `RedisEventBus`·`RequestReplyPort` import 허용(M3 무관).

## 4. 회귀 안전성

- 전송 3프리미티브만 1:1 치환. xread/xrevrange/xadd 인자(COUNT·BLOCK·STREAMS·fromId·'+'/'-') 동일. 라운드트립 순서(tip 캡처 → 요청 발행 → tip 이후 read) 보존 → 응답 누락 레이스 방지 불변.
- 테스트: `redis-agent-handler.test.ts`(tip/publish/read mock 단언), switch/register 테스트, 매니저 375. mock이 xrevrange/xadd/xread를 직접 mock하므로 bus 경유로도 동일 호출.

## 5. 테스트 (TDD)

- **포트 단위(event-bus.test.ts)**: `streamTip`(xrevrange '+' '-' COUNT 1·빈 결과 '0-0' 폴백), `readFrom`(xread COUNT/BLOCK/STREAMS/fromId·null 패스스루).
- **3사이트**: 기존 테스트가 bus 위임 후 전부 통과(회귀 0).

## 6. 영향 파일

- **수정**: `xzawedShared/src/streams/event-bus.ts`(+`__tests__/event-bus.test.ts`, +index export), `xzawedManager/.../tools/redis-agent-handler.ts`·`switch-project.ts`·`register-project.ts`, `xzawedShared/CLAUDE.md`·`xzawedManager/CLAUDE.md`.

## 7. 검증·머지

`cd xzawedShared && pnpm build && pnpm test` + 매니저 `pnpm build && pnpm test`(375) + audit + 루트 jscpd. **RedisAgentHandler 핵심경로 — 강한 적대적 리뷰**(라운드트립 의미론·tip-before-send·인자 동치). PR → CI 그린 → squash 머지. HANDOFF·메모리 갱신. **이후 P1c 완료 → P1d 착수.**
