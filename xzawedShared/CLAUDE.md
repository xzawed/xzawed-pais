# CLAUDE.md — xzawedShared

## 프로젝트 개요

xzawedShared(`@xzawed/agent-streams`)는 xzawed 멀티 에이전트 시스템의 **공통 기반 라이브러리**다.
7개 독립 에이전트 서비스가 공통으로 사용하는 `BaseConsumer<T>` 제네릭 Redis Streams 소비자, 경로 보안 유틸리티, SessionDispatcher, 에이전트 간 협업 헬퍼, 도메인 위키 주입 포매터를 제공한다.

**현재 상태: 구현 완료 (238 테스트 통과)**

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
│   ├── base-consumer.ts         # BaseConsumer<T> 제네릭 클래스 (DLQ 키·멱등 마커는 dlq.ts 재사용)
│   ├── dlq.ts                   # DLQ 계약 단일출처(dlqStreamKey·idemKey·defaultDedupKey·DlqMessageSchema) + redriveDlq 운영 도구
│   ├── event-bus.ts             # EventBus 발행 추상화 + RedisEventBus 어댑터
│   ├── session-dispatcher.ts    # SessionDispatcher — per-session 동적 consumer 팩토리, ConsumerLike
│   └── collaboration.ts         # 협업 handle 골격 공통화 (runCollaborativeHandle 등)
├── claude/
│   └── answer-query.ts          # Claude 호출·텍스트 추출·질의 응답 공통 로직
├── types/
│   ├── agent-query.ts           # 에이전트 간 질의 타입·스키마 (AgentQuery 등)
│   ├── event-envelope.ts        # EventEnvelope·makeEnvelope (correlation/causation/idempotency)
│   └── work-package.ts          # WorkPackageSchema (§7 계약: risk·inputs·outputs·epicId·고정 attributionCounters{impl,task,plan})
├── prompt/
│   └── domain-knowledge.ts      # formatDomainKnowledge() — 도메인 위키 주입 포매터
├── task-graph/                  # P1d Task Manager Core (순수 그래프/스케줄링 로직)
│   ├── task-graph.ts            # TaskGraph 타입 + buildTaskGraph(인접/역인접 인덱스)
│   ├── topo-sort.ts             # detectCycle(DFS) + topoSort(Kahn·id사전순 결정론)
│   ├── readiness.ts             # isReady/readyNodes (DoR 가드·주입형 술어)
│   ├── oracle-dor.ts            # P3-1 oracleSatisfiedSet + ApprovedOracleView (§8 DoR satisfied-set)
│   └── index.ts                 # task-graph 배럴 export
├── budget/                      # §13 budget 서킷브레이커 (순수·인메모리)
│   ├── budget-circuit.ts        # MODEL_PRICING·costOf·BudgetCircuitBreaker·BudgetExceededError
│   └── index.ts                 # budget 배럴 export
├── resilience/                  # §13 provider 서킷브레이커 (순수 상태머신)
│   ├── provider-circuit.ts      # ProviderCircuitBreaker(closed/open/half_open)·ProviderCircuitOpenError
│   └── index.ts                 # resilience 배럴 export
├── decomposition/               # P2-1 결정론 분해 코어 (순수 함수·I/O 0)
│   ├── coverage-matrix.ts       # coverageMatrix — §6 P4 커버리지 매트릭스(gaps·overlaps·unknownClaims)
│   ├── content-hash.ts          # contentHashId — §6 P7 안정 WP ID(wp_<sha256 32hex>)
│   ├── stable-merge.ts          # mergeKeepInflight — §6 재진입 병합(in-flight+의존 폐포 보존)
│   ├── order.ts                 # byId — id 사전순 비교자 공용 헬퍼
│   └── index.ts                 # decomposition 배럴 export
└── __tests__/
    ├── workspace-guard.test.ts  # validateWorkspaceRoot + resolveWorkspaceRoot 테스트
    ├── base-consumer.test.ts    # BaseConsumer 테스트
    ├── dlq.test.ts              # dlqStreamKey/idemKey/DlqMessageSchema/redriveDlq 테스트
    ├── budget-circuit.test.ts   # costOf/BudgetCircuitBreaker/BudgetExceededError 테스트
    ├── provider-circuit.test.ts # ProviderCircuitBreaker 상태머신(open/half_open/cooldown) 테스트
    ├── session-dispatcher.test.ts  # SessionDispatcher 테스트
    ├── agent-query.test.ts      # AgentQuery / parseAgentQuery 테스트
    ├── answer-query.test.ts     # answerViaClaude / callClaudeText 등 테스트
    ├── collaboration.test.ts    # runCollaborativeHandle / createCollaborativeHandler 테스트
    ├── event-bus.test.ts        # RedisEventBus 테스트
    ├── domain-knowledge.test.ts # formatDomainKnowledge 테스트
    ├── task-graph.test.ts       # buildTaskGraph/detectCycle/topoSort/isReady 테스트
    ├── oracle-dor.test.ts       # oracleSatisfiedSet (§8 DoR satisfied-set) 테스트
    └── decomposition.test.ts    # coverageMatrix/contentHashId/mergeKeepInflight + 패키지 export 테스트
```

## Task Manager Core 패턴 (P1d-1)

P1d 결정론적 Task Manager의 **순수 계산 코어**(I/O·DB·Redis·부수효과 0). WP 의존성 그래프(DAG)에서 ready 노드를 결정론적으로 산출한다. 영속(P1d-3)·소비(P1d-2)·디스패치(P1d-4)는 후속 슬라이스가 이 코어를 호출.

```typescript
import { buildTaskGraph, detectCycle, topoSort, isReady, readyNodes } from '@xzawed/agent-streams'
import type { TaskGraph, ReadinessOptions } from '@xzawed/agent-streams'

const graph = buildTaskGraph(workPackages)          // 인접/역인접 인덱스(중복id·dangling dep throw)
const cycles = detectCycle(graph)                    // 사이클 경로[](없으면 []) — 수선은 소비단 책임
const { order, cyclic } = topoSort(graph)            // Kahn 위상정렬(id 사전순 결정론), 사이클은 cyclic 보고
const ready = readyNodes(graph)                      // ready id[](topo 순서·cyclic 제외)
```

- **노드 = `WorkPackage` 재사용**(재정의 금지), `TaskGraph` = 불변 컨테이너(nodes·dependencies·dependents).
- **DoR 가드**(`isReady`): 모든 dependency가 done **AND** 오라클 충족 **AND** 자신이 아직 done 아님. `wp.status`를 읽지 않음(상태머신 드리프트 회피) — done은 `isDone` 술어, 오라클은 `oracleSatisfied` 술어로 주입(기본 `status==='done'`·`oracleRef != null`). **P3-1 도착**: `oracleSatisfiedSet`(아래)이 산출한 집합으로 `oracleSatisfied = (wp) => set.has(wp.id)` 술어를 교체(Manager `handleDispatch`가 주입).
- **결정론**: 같은 그래프 → 같은 order(타이브레이크 id 사전순, 입력순서 무관). N4 step-N 토대.

### Oracle DoR satisfied-set (P3-1, `task-graph/oracle-dor.ts`)

§8 DoR 게이트의 순수 코어. 사람 승인 오라클로 어느 WP가 디스패치 가능한지(satisfied) 결정론적으로 산출(I/O·DB 0). Manager `OracleRepo.approvedByWorkflow`가 `ApprovedOracleView[]`를 만들어 주입.

```typescript
import { oracleSatisfiedSet } from '@xzawed/agent-streams'
import type { ApprovedOracleView } from '@xzawed/agent-streams'

// ApprovedOracleView = { storyId, coveredCriteria: Set<string> } — ≥1 human_approved 시나리오가 덮는 AC 집합(repo 산출)
const satisfied = oracleSatisfiedSet(workPackages, approvedOracles) // Set<wpId>
```

- WP satisfied ⇔ `storyId` 바인딩 approved 오라클 존재 **AND** `wp.acceptanceCriteria` 전부가 그 오라클 `coveredCriteria`에 포함. 빈 AC는 오라클 존재 시 vacuously true.
- story당 approved 오라클 1개 불변식(승인이 이전 버전 supersede); 다중이면 마지막 우선. 입력 순서 무관(결정론).

## §13 Budget 서킷브레이커 패턴 (`budget/budget-circuit.ts`)

senario §13의 budget 서킷 — 토큰 비용 누적 상한(워크플로/일)을 강제하는 순수 인메모리 코어. 병렬 subagent·Deep Research(P2 Wiki Agent·P4 적대검증)의 비용 폭발을 본격화 이전에 막는 횡단 보호.

```typescript
import { BudgetCircuitBreaker, costOf, BudgetExceededError } from '@xzawed/agent-streams'
import type { TokenUsage } from '@xzawed/agent-streams'

const breaker = new BudgetCircuitBreaker({ perWorkflowUsd: 5, dailyUsd: 50 }) // 0/미지정=비활성
breaker.check(workflowId)              // 호출 전: 누적 ≥ 상한이면 BudgetExceededError throw(fail-closed)
const r = breaker.record(workflowId, model, usage) // 호출 후: usage→USD 누적, { workflowUsd, dailyUsd, tripped }
```

- **`costOf(model, usage)`**: 모델별 가격표(`MODEL_PRICING`, claude-api 레퍼런스)로 USD 환산. 캐시 토큰 가중(쓰기 1.25×·읽기 0.1×). 미지 모델은 Opus-tier로 보수적 폴백. 빈 usage=0.
- **누적 ≥ 상한 시 다음 `check`가 차단**: 호출 비용은 사전 미상이라 임계를 넘긴 호출은 완료하고 이후 호출을 막는다(보수적 게이트).
- **인메모리·주입형 clock**: 일(UTC) 카운터는 `now`로 롤오버. 재시작 시 일 카운터 소실(per-workflow는 워크플로가 한 프로세스라 정확). I/O·DB 0.
- **소비자 측**(Manager): 러너 tool-loop이 `check`(stop=throw→error 발행 M8)/`record`(트립 시 onTrip 알림)를 배선. 트립은 OPERATIONS_DECISIONS §1 DEGRADED→SAFE 강등 신호의 입력(상태머신 전이는 P6).

## §13 Provider 서킷브레이커 패턴 (`resilience/provider-circuit.ts`)

provider(Anthropic API)의 지속 장애에 대한 고전 circuit breaker. 순수 상태머신(closed→open→half_open)·provider-agnostic — **무엇이 "실패"인지는 호출자가 판정**(429/5xx/529·연결/타임아웃)해 `onFailure`/`onSuccess`를 호출한다.

```typescript
import { ProviderCircuitBreaker, ProviderCircuitOpenError } from '@xzawed/agent-streams'

const cb = new ProviderCircuitBreaker({ failureThreshold: 5, cooldownMs: 30_000 })
cb.before()       // open이고 cooldown 미경과면 ProviderCircuitOpenError throw(fail-fast). 경과면 half_open 1회 probe 허용
cb.onSuccess()    // 성공 → closed·카운터 리셋
cb.onFailure()    // 실패 → 카운트++(half_open은 즉시 재open)·임계 도달 시 open. 반환=새로 open됐는지(알림)
```

- **상태**: closed(정상)→연속 실패 임계 도달→open(cooldown 동안 fail-fast)→cooldown 경과 시 `before`가 half_open으로 1회 probe→성공 closed/실패 재open.
- **provider-agnostic**: SDK 에러 분류는 호출자(Manager 러너 `isProviderFailure` — `.status`/`.name` duck-typing)가 담당. 코어는 success/failure 신호만 받는다(테스트·다른 provider 재사용 용이).
- **소비자 측**(Manager): 러너가 `before`(open이면 throw→error 발행=stop)·실패 시 `onFailure`(429/5xx/529·연결/타임아웃만·400 등 미반영)·성공 시 `onSuccess`를 배선. 트립은 OPERATIONS_DECISIONS §1 NORMAL→DEGRADED 강등 신호 입력(전이는 P6).

## WorkPackage §7 계약 스키마 (`types/work-package.ts`)

senario 사양 §7의 기계 디스패치 가능한 작업 단위 계약. Task Graph 노드로 재사용되며, 분해→디스패치→검증→결함 국소화의 토대다.

```typescript
import { WorkPackageSchema, WpRiskSchema, AttributionCountersSchema } from '@xzawed/agent-streams'
import type { WorkPackage, WpRisk } from '@xzawed/agent-streams'
```

- **§7 필드**: `id`(content-hash)·`storyId`·`epicId`(nullable)·`owningRole`·`inputs`·`outputs`·`oracleRef`·`acceptanceCriteria`·`dependencies`·`risk`(LOW/MEDIUM/HIGH)·`attributionCounters`·`status`.
- **`risk`**: Wiki Agent 리스크 분류기(P2 잔여)가 채우기 전 기본 `MEDIUM`(중립·보수적). θ_risk 게이트·모델 라우팅 입력.
- **`attributionCounters`**: 계약 사슬 3계층 고정 `{impl, task, plan}`(자유형 record 아님 — 미지 키는 strip·부분 입력은 0으로 채움). P4c 진동 차단(N5) 입력.
- **id 정체성 분리(N4)**: `contentHashId`는 `storyId·owningRole·acceptanceCriteria`만 해싱 — `risk·inputs·outputs·epicId`(§7 추가분)·status·oracleRef·dependencies·attributionCounters는 **제외**. 리스크 재분류·계약 정련이 id를 바꾸지 않는다.
- **backward-compat(additive)**: 추가 필드는 전부 default 보유 → 레거시 영속 WP(필드 부재·`attributionCounters:{}`)도 재parse 시 기본값으로 정규화. ⚠️ `owningRole`은 WP0 #3(토폴로지) 미해결로 아직 자유 string(enum 보류).

## 결정론 분해 코어 패턴 (P2-1)

senario §6 분해 파이프라인의 결정론 경계(커버리지 매트릭스·안정 ID·재진입 병합)를 순수 함수로 구현. I/O·LLM 0. LLM 의미 분해(P2-2)가 이 함수들을 단계 사이에서 호출.

```typescript
import { coverageMatrix, contentHashId, mergeKeepInflight } from '@xzawed/agent-streams'
import type { StoryCoverage, CoverageMatrix, WpHashInput, MergeOptions } from '@xzawed/agent-streams'

const m = coverageMatrix(stories, deliverables)   // §6 P4 100% 규칙: gaps·overlaps·unknownClaims (데이터 보고, throw 아님)
const id = contentHashId({ storyId, owningRole, acceptanceCriteria })  // §6 P7 안정 ID: wp_<sha256 32hex>, deps/status 제외(연쇄 안정)
const merged = mergeKeepInflight(existing, incoming, { isInflight })    // §6 재진입 병합: in-flight+의존 폐포 보존, 출력 buildTaskGraph 수용
```

- **결정론**: `byId` UTF-16 코드포인트 정렬(`localeCompare` 금지) — 같은 입력 → 같은 출력 보장.
- **`contentHashId`**: `{storyId, owningRole, acceptanceCriteria}`만 해싱. `status`·`oracleRef`·`dependencies`·`attributionCounters` 제외 — 연쇄 안정(이 필드 변경 시 id 변경 없음).
- **`mergeKeepInflight`**: 주입형 `isInflight`(기본 `status ∈ {in_progress, blocked, done}`)로 in-flight 판정. 보존 노드의 `existing` 의존 폐포 유지 — dangling 0, `existing`은 유효 그래프 전제. 출력은 `buildTaskGraph` 직접 수용.
- **`byId`**: `decomposition/order.ts` 공용 — `task-graph/` 등 여러 모듈에서 재사용.

## EventBus 패턴 (P1c)

전송 계층(Redis Streams) 추상화. 직접 stream 명령을 한 곳(`RedisEventBus`)으로 모아 교체·테스트 가능하게 한다.

```typescript
import { RedisEventBus } from '@xzawed/agent-streams'
import type { EventBus, PublishOptions, StreamConsumerPort } from '@xzawed/agent-streams'

const bus = new RedisEventBus(redis)
// 발행(P1c-1)
await bus.publish(`planner:to-manager:${sessionId}`, message)             // 일반
await bus.publish(`watcher:to-manager:${sessionId}`, message, { maxlen: 1000 }) // approximate MAXLEN
// 소비 전송(P1c-2)
await bus.ensureGroup(stream, group)                                       // xgroup CREATE(BUSYGROUP 무시)
const reply = await bus.readGroup(stream, group, consumer, { count: 10, blockMs: 1000 }) // xreadgroup '>'
await bus.ack(stream, group, ids)                                         // xack(pipeline 배치+폴백)
await bus.autoclaim(stream, group, consumer, { minIdleMs: 300000, count: 10 }) // xautoclaim
```

- **발행(P1c-1)**: `publish(stream, message, opts?)` — JSON 직렬화 후 `xadd`. xadd 결과(`string | null`)를 그대로 반환 — null 정책은 호출자(매니저 `StreamProducer` throw, 에이전트 Producer 무시) 결정. 7에이전트 `Producer`+매니저 `StreamProducer`가 위임(외부 API·키·검증 불변, `PublisherLike` 유지 → OutboxRelay 무수정).
- **소비 전송(P1c-2/4, `StreamConsumerPort extends EventBus`)**: `ensureGroup`/`readGroup`/**`readGroupMulti`**(다중 스트림 fan-in, ids 1:1·길이 불변식)/`ack`/`autoclaim` — ioredis raw shape 보존. `BaseConsumer`가 생성자에서 `new RedisEventBus(redis)`를 만들어 `xgroup`/`xreadgroup`/`xack`/`xautoclaim`/DLQ `xadd`를 위임(생성자 시그니처 불변 → 7에이전트 무변경). 매니저 `StreamConsumer`·`SessionGatewayConsumer`(P1c-3)·`WatcherEventConsumer`(P1c-4, readGroupMulti)도 위임. **오케스트레이션(루프·dedup·재시도·DLQ 판정·never-throws·각 컨슈머 생명주기)은 호출자에 유지**. dedup `set`(멱등 claim)·`close()`/`stop()` 생명주기(quit/disconnect)는 raw redis 유지(후속 정리).
- **요청-응답(P1c-5, `RequestReplyPort extends EventBus`)**: `streamTip`(xrevrange tip)·`readFrom`(비그룹 xread BLOCK) — 그룹 소비와 직교한 RPC 라운드트립. 매니저 `RedisAgentHandler`(도구 디스패치 핵심경로)·`switch-project`·`register-project`가 `tip→publish→readFrom` 위임(tip-before-send 레이스·deadline·도메인 파싱 보존). `RedisEventBus`가 EventBus·StreamConsumerPort·RequestReplyPort 전부 구현(한 어댑터).
- ⚠️ orchestrator(별도 스택)·매니저 `ensureSessionStream`(xgroup)/`notifyGateway`·lease/멱등은 후속(P1d).

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

## DLQ 계약·재처리 패턴 (`streams/dlq.ts`)

BaseConsumer가 poison 메시지를 격리하는 `{stream}:dlq` 키와 멱등 마커 `idem:{stream}:{key}`의 **단일출처**. base-consumer.ts가 `dlqStreamKey`·`idemKey`·`defaultDedupKey`를 재사용해 쓰기 경로와 재처리 도구의 키 포맷이 드리프트하지 않게 한다(dlq.ts는 base-consumer를 import하지 않음 — 순환 회피).

```typescript
import { redriveDlq, dlqStreamKey, DlqMessageSchema } from '@xzawed/agent-streams'
import type { DlqRedis, RedriveResult } from '@xzawed/agent-streams'

// 격리된 메시지를 원 스트림으로 되돌린다(P1 운영 잔여 해소)
const result: RedriveResult = await redriveDlq(redis, 'manager:dispatched:main', {
  count: 100,          // 배치 상한(기본 100)
  reason: 'handler_failed', // 선택: 이 사유만 재처리(invalid_schema 무한 재발행 루프 회피)
})
// { read, republished, skipped }
```

- **각 엔트리**: 봉투 파싱 → (reason 필터) → **멱등 마커 삭제(재발행 전)** → 원본을 원 스트림 재발행(소비자 그룹이 XREADGROUP 픽업) → DLQ에서 제거(재실행 시 이중 재발행 방지).
- **마커 선삭제**가 핵심: handler_failed 엔트리는 처음 처리 시 SETNX로 마커가 설정돼 있어, 삭제하지 않으면 재발행본이 dedup-skip된다. dedup 키 없음(envelope·messageId 없음)이면 마커 삭제 건너뜀.
- **never-block 드레인**: 파싱 불가·엔트리별 실패는 skip(엔트리 보존)하고 배치를 계속. 재발행 후 XDEL 실패로 엔트리가 남아도 소비자 멱등 소비가 이중 처리를 흡수(재발행본은 새 마커로 dedup).
- **소비자 측**(Manager): `POST /api/admin/dlq/redrive`(admin.route.ts)가 이 함수를 **인증 필수** 라우트로 노출(부수효과 권한 엔드포인트라 authHook 없으면 server.ts가 미등록 — open admin endpoint 금지).

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
