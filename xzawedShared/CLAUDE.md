# CLAUDE.md — xzawedShared

## 프로젝트 개요

xzawedShared(`@xzawed/agent-streams`)는 xzawed 멀티 에이전트 시스템의 **공통 기반 라이브러리**다.
7개 독립 에이전트 서비스가 공통으로 사용하는 `BaseConsumer<T>` 제네릭 Redis Streams 소비자, 경로 보안 유틸리티, SessionDispatcher, 에이전트 간 협업 헬퍼, 도메인 위키 주입 포매터를 제공한다.

**현재 상태: 구현 완료 (122 테스트 통과)**

## 핵심 명령어

```bash
pnpm install       # 의존성 설치
pnpm build         # TypeScript 컴파일 → dist/ (다른 서비스 테스트 전 반드시 먼저 실행)
pnpm typecheck     # tsc 타입 체크
pnpm test          # Vitest 테스트
```

## 디렉토리 구조

```
src/
├── index.ts                     # 패키지 진입점 — 아래 모든 public export 재노출
├── workspace-guard.ts           # validateWorkspaceRoot() / resolveWorkspaceRoot() — 파일시스템 루트 거부
├── streams/
│   ├── base-consumer.ts         # BaseConsumer<T> 제네릭 클래스
│   ├── event-bus.ts             # EventBus 발행 추상화 + RedisEventBus 어댑터
│   ├── session-dispatcher.ts    # SessionDispatcher — per-session 동적 consumer 팩토리, ConsumerLike
│   └── collaboration.ts         # 협업 handle 골격 공통화 (runCollaborativeHandle 등)
├── claude/
│   └── answer-query.ts          # Claude 호출·텍스트 추출·질의 응답 공통 로직
├── types/
│   └── agent-query.ts           # 에이전트 간 질의 타입·스키마 (AgentQuery 등)
├── prompt/
│   └── domain-knowledge.ts      # formatDomainKnowledge() — 도메인 위키 주입 포매터
└── __tests__/
    ├── workspace-guard.test.ts  # validateWorkspaceRoot + resolveWorkspaceRoot 테스트
    ├── base-consumer.test.ts    # BaseConsumer 테스트
    ├── session-dispatcher.test.ts  # SessionDispatcher 테스트
    ├── agent-query.test.ts      # AgentQuery / parseAgentQuery 테스트
    ├── answer-query.test.ts     # answerViaClaude / callClaudeText 등 테스트
    ├── collaboration.test.ts    # runCollaborativeHandle / createCollaborativeHandler 테스트
    ├── event-bus.test.ts        # RedisEventBus 테스트
    └── domain-knowledge.test.ts # formatDomainKnowledge 테스트
```

## EventBus 패턴 (P1c)

발행 전송 계층 추상화. 직접 `redis.xadd` 호출을 한 곳으로 모아 전송계층을 교체·테스트 가능하게 한다.

```typescript
import { RedisEventBus } from '@xzawed/agent-streams'
import type { EventBus, PublishOptions } from '@xzawed/agent-streams'

const bus = new RedisEventBus(redis)
await bus.publish(`planner:to-manager:${sessionId}`, message)            // 일반
await bus.publish(`watcher:to-manager:${sessionId}`, message, { maxlen: 1000 }) // approximate MAXLEN
```

- `publish(stream, message, opts?)` — message를 JSON 직렬화해 `xadd`. xadd 결과(`string | null`)를 그대로 반환 — **null 정책은 호출자**(매니저 `StreamProducer`는 throw, 에이전트 Producer는 무시)가 결정해 기존 동작을 100% 보존.
- 7에이전트 `Producer` + 매니저 `StreamProducer`가 직접 xadd 대신 이 어댑터에 위임(외부 API·스트림 키·검증 불변). 매니저 `publishRaw`는 `PublisherLike` 충족 유지 → OutboxRelay 무수정.
- 전송 전용 — 재시도/DLQ/dedup은 소비자(BaseConsumer) 책임. **소비(subscribe/consume)는 후속 슬라이스에서 `EventBus` 확장.** ⚠️ orchestrator는 `@xzawed/agent-streams` 미의존(별도 스택)이라 범위 밖.

## BaseConsumer 패턴

```typescript
class BaseConsumer<TMessage> {
  constructor(
    redis: Redis,
    onMessage: (msg: TMessage) => Promise<void>,
    consumerGroup: string,
    consumerName: string,
    streamPrefix: string,            // 예: 'manager:to-tester'
    schema: ZodType<TMessage>,       // safeParse로 메시지 검증
    sleep?: (ms: number) => Promise<void>, // 테스트용 주입
    ownsRedis?: boolean,             // 기본 true: close() 시 redis.quit()
    maxDeliveries?: number,          // 기본 3: 핸들러 실패 시 재시도 상한
    dedup?: { enabled?: boolean; ttlSec?: number; key?: (msg: TMessage) => string | null }, // 멱등 소비(M6)
  )

  async start(sessionId: string): Promise<void>  // XREADGROUP 루프 시작
  stop(): void                                    // 루프 중단
}
```

**동작 세부사항:**
- `start(sessionId)`: 스트림 `${streamPrefix}:${sessionId}` 구독. Consumer Group 자동 생성 (BUSYGROUP 무시)
- 메시지 처리(per-message `handleMessage`, **throw 안 함 → 배치 비차단·PEL 누수 0**): `parseOrDlq`(추출·검증) → `isDuplicate`(멱등 dedup) → `dispatchWithRetry`(핸들러 호출) → `xack`
- **바운드 재시도 + DLQ**(senario §12 사다리 5단 '격리'): 유효 메시지 핸들러가 throw하면 `maxDeliveries`(기본 3, `Math.max(1,·)` 클램프)회 백오프 재시도, 소진 시 `{streamPrefix}:{sessionId}:dlq`로 격리(`reason:'handler_failed'`·attempts·error, `MAXLEN ~ 1000`) 후 ack. JSON/스키마 무효는 즉시 DLQ(`reason:'invalid_schema'`). 구조적 결함(data 없음·undefined·10MiB 초과)은 ack+skip(DLQ 아님). DLQ 발행(xadd) 실패는 경고 후 진행(비차단). `handleMessage`는 최종 try/catch로 어떤 내부 예외도 흡수(never-throws 계약)
  - **⚠️ 비멱등 주의**: P1a 재시도는 `onMessage`를 처음부터 재실행하므로, 핸들러 부수효과(파일 쓰기·빌드·테스트 실행·커밋)가 멱등하지 않으면 transient 실패 시 최대 `maxDeliveries`회 중복 실행될 수 있다(같은 delivery 내). 별개 *delivery*(재전달·중복발행)의 중복 실행은 아래 멱등 소비로 차단.
- **멱등 소비(M6, P1b)**: `dispatchWithRetry` 직전 delivery당 1회 `SET idem:{stream}:{key} 1 NX EX {ttl}`. 키=`envelope.idempotencyKey ?? messageId`(`dedup.key`로 주입 가능, 둘 다 없으면 dedup skip). 중복(SETNX null)이면 `onMessage` 없이 skip+ack — 재전달(XAUTOCLAIM)·outbox 중복발행을 effective-exactly-once로 마감. delivery당 1회라 P1a 인-프로세스 재시도는 막지 않음. `SHARED_IDEMPOTENT_CONSUME`(기본 ON·`=false` 가역)·`SHARED_IDEM_TTL_SEC`(기본 86400) env. SETNX 오류는 fail-open(처리 계속·never-throws 보존). ⚠️ 처리 중 크래시는 재전달 skip으로 미완성 작업 유실 가능(핸들러 트랜잭션 멱등은 후속).
- `xreadgroup` 오류 재시도: 1초부터 최대 30초까지 지수 백오프
- XAUTOCLAIM(시작 시 1회): 5분 이상 미처리(컨슈머 死) 메시지를 재획득해 동일 `handleMessage` 경로로 처리

## validateWorkspaceRoot 패턴

```typescript
import { validateWorkspaceRoot } from '@xzawed/agent-streams'

// executor.ts의 validatePath() 최상단에서 호출
validateWorkspaceRoot(workspaceRoot)  // 파일시스템 루트(/, C:\)이면 즉시 throw
```

`path.resolve(workspaceRoot) === path.parse(resolved).root`이면 `Error('WORKSPACE_ROOT must not be filesystem root')` throw.

Builder, Tester, Watcher, Security 4개 서비스의 `executor.ts`에서 공통 사용.

## SessionDispatcher 패턴

Phase 3에서 추가된 per-session 동적 consumer 팩토리. 게이트웨이 스트림을 구독해 세션별 독립 consumer를 생성한다. 주입형 consumer는 `ConsumerLike` 타입으로 추상화된다.

## 협업 라이브러리 (P1)

#186~#208에서 추가된 에이전트 간 협업 공통 헬퍼. 7개 에이전트가 동일한 handle 골격·Claude 호출·질의 처리 boilerplate를 재사용해 중복을 제거한다.

**에이전트 간 질의(`types/agent-query.ts`)**

```typescript
import { AgentQuery, AgentQuerySchema, parseAgentQuery, collaborationPayloadFields } from '@xzawed/agent-streams'
import type { AgentQueryKind, AgentQueryPayload } from '@xzawed/agent-streams'
```

- `AgentQuery` — 에이전트가 다른 에이전트에게 질의할 때 runner가 반환하는 클래스. `handle()`이 `instanceof`로 분기해 `agent_query` 메시지로 발행 (Planner `ClarificationNeeded`를 일반화)
- `parseAgentQuery(parsed)` — Claude 응답 JSON이 `{ agent_query: true, to, question, kind }`이면 `AgentQuery`, 아니면 `null`
- `AgentQuerySchema` — `agent_query` payload Zod 스키마. `kind`는 `'active_request' | 'cross_check'`(기본 `active_request`)
- `collaborationPayloadFields` — 각 에이전트 `ManagerTo{Agent}MessageSchema` payload에 spread하는 공통 입력 필드(`clarificationContext`·`query`·`queryKind`)

**Claude 호출 공통 로직(`claude/answer-query.ts`)**

```typescript
import { answerViaClaude, callClaudeText, extractClaudeText, stripJsonFences } from '@xzawed/agent-streams'
import type { ClaudeLike } from '@xzawed/agent-streams'
```

- `callClaudeText(client, model, maxTokens, system, userContent, timeoutMs)` — 타임아웃 race + 텍스트 추출 공통 호출
- `answerViaClaude(client, model, systemPrompt, query, context)` — 다른 에이전트 질의에 Claude로 답하는 공통 로직(`callClaudeText` 위에 1024 토큰·120s)
- `extractClaudeText(content)` — 응답 content에서 텍스트 블록만 합침
- `stripJsonFences(text)` — Claude가 감싸는 ` ``` `/` ```json ` 코드 펜스 제거
- `ClaudeLike` — Anthropic 클라이언트의 최소 구조적 인터페이스(테스트 주입용)

**handle 골격 공통화(`streams/collaboration.ts`)**

```typescript
import { runCollaborativeHandle, makeCollaborationContext, createCollaborativeHandler } from '@xzawed/agent-streams'
import type { MainOutcome, CollabMessage, MessageBase, CollaborativeAgentDeps } from '@xzawed/agent-streams'
```

- `createCollaborativeHandler(deps)` — 협업 에이전트의 handle 함수를 만드는 **팩토리**. `completeType`과 `runMain`(고유 로직)만 주입하면 base 생성·query 모드·정상/질의/error 경로를 공유
- `runCollaborativeHandle(opts)` — handle 1회의 공통 골격: abort 종료 → query 모드 응답 → `runMain` 후 `AgentQuery`면 질의 발행, 산출물이면 결과 발행, 예외는 모두 error 발행
- `makeCollaborationContext(publish, sessionId, completeType)` — 메시지 `base` + `publishQueryAnswer`/`publishError` 콜백 생성
- `MainOutcome` — `runMain` 결과 타입: `AgentQuery | { publishResult }`

## 도메인 위키 주입 포매터 (`prompt/domain-knowledge.ts`)

```typescript
import { formatDomainKnowledge } from '@xzawed/agent-streams'

const block = formatDomainKnowledge(context)  // LLM userContent 앞에 prepend
```

`context.domainKnowledge`(Manager 주입)를 `## 이전 프로젝트 도메인 지식 (반드시 존중하고 활용)` 라벨 블록으로 렌더한다. 각 항목은 `- {content} ({sourceAgent})` 형태. 없거나 비면 빈 문자열을 반환해 프롬프트에 영향이 없다. 생성형 에이전트가 이전 프로젝트 결정·제약을 first-class 섹션으로 받아 활용하도록 한다.

## 의존 관계

```
xzawedShared (@xzawed/agent-streams)
    ↑ 사용
xzawedPlanner / xzawedDeveloper / xzawedDesigner /
xzawedTester / xzawedBuilder / xzawedWatcher / xzawedSecurity
```

## 주의사항

- **다른 서비스 테스트 전 반드시 먼저 빌드**: `pnpm build`
- CI 워크플로우(`ci.yml`)는 xzawedShared를 먼저 빌드 후 나머지 서비스를 병렬 실행
- 로컬에서 `pnpm build` 없이 독립 에이전트 서비스 테스트를 실행하면 `@xzawed/agent-streams` 패키지를 찾지 못해 실패

## 환경 변수

없음. 순수 라이브러리이며 직접 실행되지 않는다.
