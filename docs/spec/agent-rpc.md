# 에이전트 RPC

Manager가 7개 에이전트를 호출하는 경계. **양쪽이 구조적으로 다른 언어로 계약을 쓴다** — Manager 쪽은 LLM에 노출하는 Anthropic JSON Schema, 에이전트 쪽은 Zod다. 어떤 단일 타입도 이 경계를 span할 수 없으므로 여기가 정본이다.

## 경계

| 방향 | 보내는 쪽 | 받는 쪽 | 전송 |
|---|---|---|---|
| 요청 | `tools/redis-agent-handler.ts` `publishRequest` | 각 `src/streams/consumer.ts`(BaseConsumer) | `manager:to-{agent}:{sessionId}` |
| 세션 개통 | `tools/redis-agent-handler.ts` `notifyGateway` | `xzawedShared/src/streams/session-dispatcher.ts` | `manager:to-{agent}:sessions` |
| 세션 종료 | `tools/redis-agent-handler.ts` `endGateway` | 같음 | 같음. 세션 소비자와 전용 Redis 연결을 회수시킨다 |
| 응답 | 각 `src/streams/producer.ts` | `tools/redis-agent-handler.ts` `handleMessage` | `{agent}:to-manager:{sessionId}` · **그룹 없음, tip 선취 후 폴링** |
| 파일 이벤트 | `xzawedWatcher/src/watcher.ts` | `streams/watcher-event-consumer.ts` | `watcher:to-manager:{sessionId}` |
| 자율 워커 | `streams/worker.ts` `buildWorkerInput` | 위 요청 스트림과 동일 | LLM을 우회해 같은 핸들러를 직접 호출 |

Manager 쪽 발행자는 `RedisAgentHandler` **하나뿐**이다.

## 계약

**도구 7종의 요청·완료 타입.** 필드 정본은 각 `tools/*.ts`의 `inputSchema`다 — 목록을 여기 복사하지 않는다.

| 도구 | 에이전트 | 요청 → 완료 |
|---|---|---|
| `plan_task` | Planner | `plan_request` → `plan_complete` |
| `develop_code` | Developer | `develop_request` → `develop_complete` |
| `design_ui` | Designer | `design_request` → `design_complete` |
| `run_tests` | Tester | `test_request` → `test_complete` |
| `build_project` | Builder | `build_request` → `build_complete` |
| `watch_changes` | Watcher | `watch_request` → `watch_started` |
| `security_audit` | Security | `audit_request` → `audit_complete` |

`RedisAgentHandler`는 도구 input을 payload 최상위로 spread하고 `userContext`를 나란히 붙인다.

**교차질의 공통 필드** — `xzawedShared/src/types/agent-query.ts` `collaborationPayloadFields`가 정본이다(4필드: `clarificationContext`·`query`·`queryKind`·`model`). 에이전트 6종이 spread하고 **Watcher는 하지 않는다**(Claude 미사용이라 질의 라우팅 대상에서도 제외된다).

**Manager는 이 공통 필드를 import하지 않는다.** 도구 inputSchema에 같은 필드를 따로 적는다.

## 불변식

- **`UserContext` Zod가 8곳에 독립 복제돼 있다** — Manager 정본과 에이전트 7종. shared에는 이 스키마가 없다
- **`tenantId`는 에이전트에 도달하지 않는다.** Manager 정본에는 있으나 에이전트 복제본에는 없어 Zod 기본 strip으로 소실된다. 테넌트 귀속이 필요한 에이전트 작업은 현재 불가능하다
- **응답 방향에 스키마 검증이 없다.** Manager는 `JSON.parse(raw)`를 타입 캐스트로 받고, `outputSchema.parse`는 완료 타입이 일치할 때 **payload에만** 적용된다. 봉투 3필드는 읽지도 검증하지도 않는다
- **응답 스트림에 소비자 그룹이 없다.** 비그룹 `xread`로 폴링하며 tip을 발행 **전에** 선취한다. 이 순서가 뒤집히면 응답을 영구히 놓친다
- **에이전트는 응답을 손으로 쓴 TS interface로 발행한다.** Manager의 `outputSchema`와 타입 연결이 0이므로, 한쪽만 고치면 런타임까지 조용하다
- **자율 워커는 LLM을 우회해 같은 핸들러를 부른다.** 도구 inputSchema를 바꾸면 LLM 경로와 워커 경로가 함께 영향받는다

## 강제

- `.claude/commands/contract-drift-check.md` — Planner `agentType` 유니언과 Designer `UISpec` 필드를 정의처 전수 대조
- 각 에이전트 `src/streams/consumer.test.ts` — 수신 스키마가 실제 페이로드를 통과시키는지
- `xzawedManager/packages/server/src/tools/__tests__/` — 도구별 inputSchema와 라우팅

## 하지 않은 것

- **`UserContext`를 shared로 올리지 않았다.** 8곳 복제를 하나로 줄이면 `tenantId` strip 문제도 함께 풀리지만, 7개 서비스의 `file:` 복사본을 동시에 갱신해야 하는 변경이라 별도 슬라이스가 필요하다
- **응답 방향에 Zod를 붙이지 않았다.** 기존 응답이 스키마 미달로 DLQ에 갈 수 있어 실태 측정이 선행돼야 한다
