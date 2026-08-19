# Redis 스트림 봉투

서비스 간 모든 통신이 지나는 경계. **이 봉투를 강제하는 단일 타입이 없다** — 인바운드 Zod 선언이 9곳에 독립적으로 존재하고 아웃바운드는 전부 손으로 쓴 TS interface다. tsc가 이 경계를 교차검증하지 못하므로 여기가 정본이다.

## 경계

| 방향 | 보내는 쪽 | 받는 쪽 | 스트림 · 그룹 |
|---|---|---|---|
| Orchestrator → Manager | `packages/server/src/streams/producer.ts` | `packages/server/src/streams/consumer.ts` | `orchestrator:to-manager:{sessionId}` · `manager-consumers` |
| Manager → Orchestrator | `streams/producer.ts` | `packages/server/src/streams/consumer.ts` | `manager:to-orchestrator:{sessionId}` · `orchestrator-consumers` |
| Manager → 에이전트 | `tools/redis-agent-handler.ts` | 각 `src/streams/consumer.ts`(BaseConsumer) | `manager:to-{agent}:{sessionId}` · `{agent}-consumers` |
| 에이전트 → Manager | 각 `src/streams/producer.ts` | `tools/redis-agent-handler.ts` | `{agent}:to-manager:{sessionId}` · **그룹 없음(비그룹 `xread`)** |
| Watcher → Manager | `src/streams/producer.ts` | `streams/watcher-event-consumer.ts` | `watcher:to-manager:{sessionId}` · `manager-watcher-consumers` |
| 세션 개통 | 위 발신자들 | `xzawedShared/src/streams/session-dispatcher.ts` | `{출발}:to-{목적}:sessions` |
| DLQ | `xzawedShared/src/streams/dlq.ts` | 운영 도구(`xrange` 드레인) | `{stream}:dlq` · **그룹 없음** |

## 계약

**봉투 5필드** — `sessionId` · `messageId` · `timestamp` · `type` · `payload`. 값은 전 방향 일치하나 **제약이 갈린다.**

- `sessionId` — Planner·Developer·Designer·Tester는 `.uuid()`, Builder·Watcher·Security는 `z.string()`. Orchestrator 발행측만 UUID v4 정규식을 강제하고, Manager의 게이트웨이 통지는 검증하지 않는다
- `messageId` — 어디도 uuid를 강제하지 않는다. **dedup 키의 폴백 소스**다
- `type` — 방향별 `z.enum`/`z.literal`. **`{agent}:to-manager` 방향만 Zod가 없다** — `JSON.parse(raw) as ParsedMessage` 타입 캐스트이고 봉투 3필드는 읽지도 검증하지도 않는다
- `payload` — 방향별 자유. 에이전트 6종이 `collaborationPayloadFields`를 spread하고 **Watcher는 하지 않는다**(Claude 미사용)

**경계를 실제로 span하는 것은 둘뿐이다.** 나머지는 각자 선언이다.

- `xzawedShared/src/types/agent-query.ts` `collaborationPayloadFields` — 6개 에이전트 payload 공통 필드
- `xzawedShared/src/types/event-envelope.ts` `EventEnvelopeSchema` — **Manager 내부 이벤트 전용**(`manager:*:main`). 교차 서비스 봉투와 다른 계열이다

`xzawedShared/src/streams/collaboration.ts`의 `CollabMessage`는 **저장소 어디서도 import되지 않는다.** 유일한 작용은 `createCollaborativeHandler`의 제네릭 바운드이고, 그것은 6개 에이전트의 **아웃바운드** 타입만 묶는다. 수신측이 무엇을 파싱하는지와 무관하다.

## 불변식

- **구조적 결함은 DLQ에 남지 않는다 — fail-open.** `data` 필드 없음·값 없음·크기 상한 초과는 `console.error` 후 ack+skip이다. DLQ를 뒤져도 나오지 않는다
- **JSON·스키마 무효는 재시도 없이 즉시 DLQ — fail-closed.** `invalid_schema`
- **핸들러 throw는 바운드 백오프 후 DLQ — fail-closed.** `handler_failed`. 재시도는 `onMessage`를 처음부터 재실행하므로 핸들러가 멱등하지 않으면 부수효과가 중복된다
- **`handleMessage`는 절대 throw하지 않는다.** 배치 비차단과 PEL 누수 0을 위한 계약이라, 여기에 throw를 기대하는 로직은 조용히 무시된다
- **DLQ 발행 실패도 삼켜진다 — fail-open.** `routeToDlq`가 never-throw라 격리에 실패하면 메시지가 소멸한다
- **멱등 dedup 키가 없으면 dedup을 건너뛴다 — fail-open.** 키는 `envelope.idempotencyKey ?? messageId`이고 둘 다 없으면 중복 처리가 통과한다. 마커 TTL 기본 24시간
- **Orchestrator의 `StreamConsumer`에는 DLQ가 없다.** JSON·스키마 실패 모두 로그 후 ack이고, 핸들러 예외는 ack 후 그대로 전파되어 소비 루프를 끊는다. Manager·shared와 비대칭이다
- **`UserContext.tenantId`는 에이전트에 도달하지 않는다.** Manager 정본에는 있으나 7개 에이전트의 복제본 스키마에는 없어 Zod의 기본 strip으로 소실된다

## 강제

- `xzawedShared/src/__tests__/` — BaseConsumer 재시도·DLQ 라우팅·멱등 dedup
- `.claude/commands/contract-drift-check.md` — 복제된 계약 정의의 드리프트 진단
- CI `Module Boundaries (M3)` — 서비스 간 직접 import 차단(`.dependency-cruiser.cjs`)

## 하지 않은 것

- **봉투를 shared 단일 Zod로 통합하지 않았다.** 방향별 `type` enum과 payload가 달라 공통 스키마가 얇아지고, 9곳의 선언을 한 번에 바꾸는 변경이 되기 때문이다. 대신 드리프트를 검사로 잡는다
- **`{agent}:to-manager` 방향에 Zod를 넣지 않았다.** 넣으면 기존 에이전트 응답이 스키마 미달로 DLQ에 갈 수 있어, 먼저 응답 실태를 측정해야 한다
