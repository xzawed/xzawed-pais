# P1c-3 매니저 그룹 컨슈머 포트화 설계

- 날짜: 2026-06-06
- 서비스: `xzawedManager`
- 로드맵: senario ROADMAP Phase 1 — P1c "Event Bus 추상화"의 소비자 측 후속. P1c-2(BaseConsumer→포트, #248) 다음.

## 1. 문제 & 목표

매니저의 자체 그룹 컨슈머들이 Redis 스트림 명령을 직결한다. P1c-2가 `BaseConsumer`를 `StreamConsumerPort`(xzawedShared `RedisEventBus`) 뒤로 모았듯, **매니저의 단일 스트림 그룹 컨슈머도 같은 포트로** 통일한다.

**대상**:
- `StreamConsumer`(`orchestrator:to-manager:{sessionId}`) — xgroup/xreadgroup/xack 직결.
- `SessionGatewayConsumer`(`orchestrator:to-manager:sessions`) — xgroup/xreadgroup/xack 직결.

**제외(후속)**:
- `WatcherEventConsumer` — **다중 스트림 `xreadgroup`**(`'STREAMS', ...streams, ...lastIds`)이라 현 `StreamConsumerPort.readGroup`(단일 스트림 + '>')에 미적합. 포트에 `readGroupMulti(streams[], ids[])` 확장이 필요 → 별도 슬라이스.
- `RedisAgentHandler` 요청-응답(xread/xrevrange) — 그룹-소비가 아닌 별도 요청-응답 추상화 필요 → 별도 슬라이스.

## 2. 설계 결정 (사용자 승인)

- StreamConsumer + SessionGatewayConsumer만 포트화. WatcherEventConsumer는 다중 스트림이라 제외.
- 생성자(`redisUrl`) 불변 — `getRedisClient(url)` 위에 `RedisEventBus` 지연 생성(매니저 `StreamProducer`(P1c-1) 패턴).
- per-entry ack 타이밍·BLOCK 시간·COUNT·파싱·NOGROUP 복구·루프 **전부 보존**(회귀 0).

## 3. 아키텍처

각 컨슈머에 `private get bus(): StreamConsumerPort`(지연 `new RedisEventBus(getRedisClient(this.redisUrl))`) 추가 후 전송 호출 위임:

| 기존 | 후 |
|---|---|
| `redis.xgroup('CREATE', stream, GROUP, '$', 'MKSTREAM')` + BUSYGROUP try/catch | `this.bus.ensureGroup(stream, GROUP)` |
| `redis.xreadgroup('GROUP', GROUP, id, 'COUNT','10','BLOCK','2000','STREAMS', stream, '>')` | `this.bus.readGroup(stream, GROUP, id, { count: 10, blockMs: 2000 })` |
| `redis.xack(stream, GROUP, id)` (per-entry) | `this.bus.ack(stream, GROUP, [id])` |

- **StreamConsumer**: `ensureGroup`·`start` 루프·`processEntry`의 위 3개 호출만 교체. 파싱(`OrchestratorToManagerMessageSchema`)·NOGROUP 복구·handler try/finally는 불변.
- **SessionGatewayConsumer**: 인라인 xgroup→`bus.ensureGroup`, xreadgroup→`bus.readGroup`, per-entry xack→`bus.ack([msgId])`. uuid 파싱·onSessionInit·재시도 루프 불변.

### 의존성
- 매니저는 이미 `@xzawed/agent-streams` 의존 → `RedisEventBus`·`StreamConsumerPort` import 허용(M3 무관).

## 4. 회귀 안전성

- `bus.ensureGroup`은 P1c-2에서 BaseConsumer의 BUSYGROUP-tolerant 로직과 동일. `bus.readGroup`은 동일 인자(GROUP/COUNT/BLOCK/STREAMS/'>')로 xreadgroup 호출, raw 반환 → 기존 `results` 파싱 불변.
- `bus.ack([id])`: 매니저 컨슈머 테스트 mock에 `pipeline`이 없으므로 포트의 pipeline 분기가 아닌 **개별 `redis.xack(stream, group, id)` 폴백** 실행 → 기존 호출과 바이트 동일(테스트 단언 보존). 실 운영(ioredis pipeline 있음)에선 1-원소 pipeline ack(동일 결과·무해).

## 5. 테스트

- 매니저 기존 `test/streams/consumer.test.ts`·`src/streams/session-gateway.test.ts`가 redis.xgroup/xreadgroup/xack 단언을 bus 경유로도 통과(회귀 0). 포트 자체 단위 테스트는 xzawedShared(P1c-2, 130)에서 검증됨.
- 신규 테스트 불요(전송 위임만, 동작 동일). 단, 매니저 전체 테스트(375)로 회귀 확증.

## 6. 영향 파일

- **수정**: `xzawedManager/packages/server/src/streams/consumer.ts`, `session-gateway.ts`, `xzawedManager/CLAUDE.md`(컨슈머 EventBus 위임 명시).

## 7. 검증·머지

`cd xzawedManager && pnpm build && pnpm test`(375) + `pnpm audit` + 루트 jscpd. PR → CI 그린 → squash 머지. 이후 HANDOFF·메모리 갱신.
