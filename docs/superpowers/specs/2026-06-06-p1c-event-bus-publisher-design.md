# P1c-1 Event Bus 토대 + 퍼블리셔 슬라이스 설계

- 날짜: 2026-06-06
- 서비스: `xzawedShared`(`@xzawed/agent-streams`) + 7 에이전트 + xzawedManager
- 로드맵: senario ROADMAP Phase 1 — P1a(격리·#244)·P1b(멱등·#246) 다음. P1c "Event Bus 추상화"의 **첫(퍼블리셔) 슬라이스**.

## 1. 문제 & 목표

현재 발행(publish)이 9곳에 흩어져 각자 `redis.xadd(...)`를 직접 호출한다(7 에이전트 `producer.ts` + 매니저 `StreamProducer.publish`/`publishRaw`). 전송 계층(Redis Streams)이 코드 전반에 직결돼 있어 ① 교체·테스트가 어렵고 ② xadd 호출이 중복된다.

**목표**: 발행을 `EventBus` 인터페이스 뒤로 숨겨 전송계층을 한 곳(`RedisEventBus`)으로 모은다. 이 슬라이스는 **퍼블리셔 seam만** 다룬다(가장 단순·저위험, 추상화를 실증).

**범위**: `@xzawed/agent-streams`에 의존하는 서비스만 — 7 에이전트 + xzawedManager. **xzawedOrchestrator는 `@xzawed/agent-streams` 미의존(별도 Turborepo 스택)이라 범위 밖.**

**비범위(후속 슬라이스)**: 소비자(BaseConsumer `xreadgroup`/`xack`/`xautoclaim`)·`RedisAgentHandler` 요청-응답(`xread`/`xrevrange`/`xadd`)·게이트웨이 컨슈머·orchestrator 스택·봉투(messageId/timestamp) 자동 스탬핑·per-agent Producer 완전 통합.

## 2. 설계 결정 (사용자 승인)

- **첫 슬라이스 = 토대(인터페이스+어댑터) + 퍼블리셔 마이그레이션**. 소비자/요청-응답은 다음 슬라이스.
- **per-agent `Producer` 래퍼 유지**(외부 API 불변, 내부만 `RedisEventBus` 위임) — 완전 통합은 후속.
- **OutboxRelay 무수정** — 매니저 `StreamProducer`가 `PublisherLike`(publishRaw)를 계속 충족.

## 3. 아키텍처

### 3.1 인터페이스 (`xzawedShared/src/streams/event-bus.ts`)

```ts
/** 발행 옵션. maxlen: approximate MAXLEN(~) 상한(무한 증가 방지, watcher 관례). */
export interface PublishOptions {
  maxlen?: number
}

/** 전송 계층 추상화(발행). 소비(subscribe/consume)는 후속 슬라이스에서 확장. */
export interface EventBus {
  /**
   * message를 JSON 직렬화해 stream에 발행(xadd). xadd 결과(스트림 엔트리 ID, 비정상 시 null)를
   * 그대로 반환 — null 정책은 호출자가 결정(매니저는 throw, 에이전트는 무시). 회귀 0.
   */
  publish(stream: string, message: unknown, opts?: PublishOptions): Promise<string | null>
}
```

### 3.2 어댑터 `RedisEventBus`

```ts
import type { Redis } from 'ioredis'

export class RedisEventBus implements EventBus {
  constructor(private readonly redis: Redis) {}

  async publish(stream: string, message: unknown, opts?: PublishOptions): Promise<string | null> {
    const data = JSON.stringify(message)
    return opts?.maxlen !== undefined
      ? this.redis.xadd(stream, 'MAXLEN', '~', String(opts.maxlen), '*', 'data', data)
      : this.redis.xadd(stream, '*', 'data', data)
  }
}
```

- 전송 전용: 직렬화 + xadd 외 로직 없음. xadd 예외는 전파(기존 동일 — 호출자 책임). null 반환은 호출자 정책(매니저 throw·에이전트 무시)으로 **기존 동작 100% 보존**.
- Redis 클라이언트는 주입(에이전트는 생성자 주입 인스턴스, 매니저는 `getRedisClient(url)`).

### 3.3 마이그레이션 (producer seam)

각 발행 지점을 `RedisEventBus.publish` 위임으로 바꾼다. 외부 API·스트림 키·메시지 형상은 불변.

| 파일 | 변경 |
|---|---|
| `xzawed{Planner,Developer,Designer,Tester,Builder,Security}/src/streams/producer.ts` | `Producer`가 생성자에서 `new RedisEventBus(redis)` 보관, `publish(sessionId,msg)`가 `bus.publish('{agent}:to-manager:'+sessionId, msg)` 위임 |
| `xzawedWatcher/src/streams/producer.ts` | 위와 동일 + `bus.publish(stream, msg, { maxlen: 1000 })`(기존 `MAXLEN ~ 1000` 보존) |
| `xzawedManager/packages/server/src/streams/producer.ts` | `StreamProducer.publish`·`publishRaw`가 `RedisEventBus.publish` 위임. `publishRaw(stream,msg)=bus.publish(stream,msg)` → `PublisherLike` 충족(OutboxRelay 무수정) |

- 7 에이전트 + 매니저의 `redis.xadd(...)` 직접 호출이 모두 `RedisEventBus.publish` 한 곳으로 수렴.

### 3.4 의존성·경계

- `EventBus`/`RedisEventBus`는 `@xzawed/agent-streams`에서 export → 7 에이전트·매니저가 import(허용된 공통 라이브러리 의존, M3 위반 아님).
- orchestrator는 미의존 → 자체 `StreamProducer` 그대로(이 슬라이스 무관).

## 4. 데이터 흐름

```
(기존) Producer.publish → redis.xadd(stream,'*','data',JSON)          [9곳 중복]
(후)   Producer.publish → RedisEventBus.publish(stream,msg[,opts])    [어댑터 1곳]
                          → redis.xadd(stream, ['MAXLEN','~',n,] '*','data',JSON)
OutboxRelay → StreamProducer.publishRaw → RedisEventBus.publish       [PublisherLike 불변]
```

## 5. 에러 처리

- `publish`는 xadd 예외를 전파(transport 실패는 호출 측이 처리 — 기존 동작 보존). EventBus는 자체 재시도/DLQ를 갖지 않는다(그건 소비자·BaseConsumer 책임).

## 6. 테스트 (TDD, xzawedShared)

- `RedisEventBus.publish`가 일반 xadd 인자(`stream,'*','data',JSON`)로 호출.
- `maxlen` 옵션 시 `stream,'MAXLEN','~','1000','*','data',JSON`로 호출.
- 반환값 = xadd 결과 그대로(예: `'1-0'`, 비정상 시 `null`).
- 메시지 JSON 직렬화 정확성(객체 → data 필드 문자열).
- 각 서비스 producer 기존 테스트는 그대로 통과(회귀 0) — 위임이 동작·스트림 키를 보존.

## 7. 영향 파일

- **신규**: `xzawedShared/src/streams/event-bus.ts`, `xzawedShared/src/__tests__/event-bus.test.ts`.
- **수정**: `xzawedShared/src/index.ts`(export), 7 에이전트 `producer.ts`(+ 필요 시 `producer.test.ts`), `xzawedManager/packages/server/src/streams/producer.ts`(+ 테스트), `xzawedShared/CLAUDE.md`(EventBus 섹션), 루트 `CLAUDE.md`(테스트 수).

## 8. 검증·머지

`cd xzawedShared && pnpm build && pnpm test`; 7 에이전트 + 매니저 빌드·테스트(회귀 0); `pnpm audit`; 루트 jscpd. PR → CI(module-boundaries 포함) 그린 → squash 머지. 이후 HANDOFF·메모리 갱신.
