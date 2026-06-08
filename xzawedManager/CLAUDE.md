# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedManager(총관리자)는 xzawed 멀티 에이전트 시스템의 **두 번째 계층**이다.  
xzawedOrchestrator로부터 Redis Streams로 작업 지시를 수신하고, Claude tool-calling 루프를 통해 처리한 뒤 결과를 반환한다.

현재 상태: **구현 완료 (server 479/498 테스트, 19 skip)** — 8개 ToolHandler 모두 `RedisAgentHandler` 또는 직접 Octokit 기반으로 구현. 코드로 강제하는 승인 게이트(`gates/`, **fail-safe 포함**)·프로젝트 도메인 위키(`db/knowledge.repo.ts`·`api/knowledge.route.ts`)·AgentQuery 교차질의 라우팅·**세션 이벤트소싱+아웃박스**(`db/event-store.ts`·`streams/outbox-relay.ts`, flag 가역) 추가. JWT 인증 미들웨어 에러 코드 분기 추가. Redis 계약 통합 테스트는 `REDIS_URL` 없으면 skip. consumer.ts Redis 단절 복구(xreadgroup try/catch) + xack try/finally 보장. runner.ts request_info 누락 필드·빈 tool_use 블록 입력 검증 추가.

**최근 반영(PR-1 게이트 fail-safe)**: 승인 응답이 파싱 불가·비객체·미지 decision이면 자동 승인(fail-open)하지 않고 `needs_human`으로 사람 재검토를 요청한다(같은 산출물·사유 안내, `MAX_GATE_REASKS` 초과 시 세션 중단). revise 소진도 무음 통과 대신 에스컬레이션. `MANAGER_GATE_FAILSAFE=false`로 레거시 fail-open 복원 가능. senario M8(무음 통과 금지)·N1(불확실=실패) 구현.

**최근 반영(#212~#216)**: 게이트 승인 시 PO가 저장 전 요약을 편집하는 `wikiSummary`(#212), 위키 쓰기 경로(PATCH/DELETE) 서비스 JWT 인증(#213), 전역 게이트 모드 `task_request.payload.gateMode`→`setGateDefaultMode` 배선(#215), 명확화·교차질의 **재실행 산출물도 승인 게이트를 거치도록** `finalizeAgentResult` 공통화(#216).

설계 스펙: `docs/specs/2026-05-15-manager-design.md`

## 핵심 명령어

```bash
# 의존성 설치
pnpm install

# 서버 개발 모드
cd packages/server && pnpm dev

# 전체 테스트
pnpm test

# 특정 패키지 테스트
cd packages/server && pnpm test

# 특정 테스트 파일 실행
cd packages/server && pnpm test src/tools/plan-task.test.ts

# 빌드
pnpm build
```

## 아키텍처

```
packages/
└── server/
    └── src/
        ├── index.ts            # 진입점: Redis consumer 시작
        ├── config.ts           # 환경 변수 검증
        ├── server.ts           # Fastify HTTP (/health, port 3001)
        ├── streams/            # Redis consumer + producer + outbox-relay.ts(아웃박스→Redis 폴링 릴레이). StreamConsumer·SessionGatewayConsumer(P1c-3)·StreamProducer·WatcherEventConsumer(P1c-4, readGroupMulti)·RedisAgentHandler·switch-project·register-project(P1c-5, RequestReplyPort RPC 라운드트립)는 전송을 @xzawed/agent-streams RedisEventBus(EventBus/StreamConsumerPort/RequestReplyPort)에 위임. RedisAgentHandler ensureSessionStream(xgroup)·notifyGateway는 잔류(후속). DecompositionConsumer(P1d-2, decomposition.emitted→TaskGraph 빌드·영속, 미배선). dispatch.ts(P1d-4 planDispatch 순수+handleDispatch 오케스트레이션, P1d-6 done-set 파생)·lease.ts(P1d-5b planReclaim 순수+handleLeaseSweep)·completion.ts(P1d-6 handleCompletion: 완료→재디스패치)·lease-sweeper.ts(P1d-7 LeaseSweeper 타이머)·supervisor.ts(P1d-7 Supervisor 생명주기·createSupervisor·shouldWireSupervisor·buildCompletionHandler)·dispatch-constants.ts(디스패치/lease/완료 상태·이벤트 상수 단일출처). **P1d-7부터 `TASK_MANAGER_ENABLED`+DATABASE_URL이면 server.ts에 Supervisor 배선(이전 미배선 핸들러 가동)**
        ├── decompose/          # decompose/(map.ts·producer.ts·trigger.ts) — **P2-2 분해 생산자**: decompose_request→단일 LLM 분해→content-hash WP[]→decomposition.emitted 발행(`MANAGER_DECOMPOSE_ENABLED` flag, off면 회귀 0; Supervisor가 소비)
        ├── claude/runner.ts    # Claude tool-calling 루프 (승인 게이트·위키 주입/저장·AgentQuery 라우팅)
        ├── gates/              # approval-gate.ts: 게이트 모드·대상·결정 파싱
        ├── db/                 # knowledge.repo.ts + session.repo.ts + event-store.ts(이벤트소싱 append+replay) + task-graph.repo.ts(P1d-3 Task Graph 영속) + dispatch.repo.ts(P1d-4 디스패치 원자 적재 + P1d-5a lease 획득·dedup·appendWpEvent) + lease.repo.ts(P1d-5b LeaseStore 만료 조회·reclaim·escalate + P1d-6 recordCompletion) + pool.ts + migrations/(001~008)
        ├── tools/              # ToolHandler 11개 (7 RedisAgent + register-project + switch-project + github-ops* + deploy-project* / *GITHUB_TOKEN 조건부) + agent-tool-map.ts + errors.ts
        ├── sessions/           # 세션 상태 추적 (session.store.ts: gateConfig·waitForInfo·게이트 override·EventStore 컴포지션)
        └── api/                # health 라우트 + knowledge.route.ts(GET 비인증·읽기; PATCH/DELETE는 authHook 설정 시 서비스 JWT 필요)
```

## Redis Streams 인터페이스

**수신:** `orchestrator:to-manager:{sessionId}` (consumer group: `manager-consumers`)
| type | 처리 |
|---|---|
| `task_request` | Claude tool-calling 루프 시작. `payload.gateMode`(`manual\|auto`) 있으면 세션 기본 승인 모드로 적용(`setGateDefaultMode`) |
| `info_response` | 대기 중 루프 재개. `answer`가 승인 게이트 응답이면 JSON 결정(`{decision: approve\|revise\|abort, rememberAuto?, saveToWiki?, wikiSummary?, feedback?}`)으로 해석 (`parseDecision`) |
| `abort` | 루프 즉시 중단 |
| `decompose_request` | `payload.intent` → flag on(`MANAGER_DECOMPOSE_ENABLED`)이면 단일 LLM 분해→decomposition.emitted 발행(Supervisor 소비). flag off면 분기 무시 |

**발신:** `manager:to-orchestrator:{sessionId}`
| type | 시점 |
|---|---|
| `status_update` | 도구 호출 시작/완료마다 |
| `info_request` | 사용자 추가 입력 필요 시 (uiSpec 포함 가능). 승인 게이트는 `approval: { stage, summary, mode }` 페이로드로 발행 |
| `task_complete` | 모든 처리 완료 |
| `error` | 처리 실패 |

## ToolHandler 패턴

```typescript
interface ToolHandler<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: Anthropic.Tool['input_schema']  // JSON Schema (Zod 아님 — Anthropic API에 직접 전달)
  execute(input: TInput, sessionId: string): Promise<TOutput>
}
```

11개 핸들러 (상시 9개 + 조건부 2개):

**상시 등록 (9개)**:
- 7개 `RedisAgentHandler` 팩토리: `createPlanTaskHandler`, `createDevelopCodeHandler`, `createDesignUiHandler`, `createRunTestsHandler`, `createBuildProjectHandler`, `createWatchChangesHandler`, `createSecurityAuditHandler`
- `createRegisterProjectHandler` — 프로젝트 등록 (workspace clone/init)
- `createSwitchProjectHandler` — 프로젝트 전환

**조건부 등록 (GITHUB_TOKEN 설정 시, 2개)**:
- `createGithubOpsHandler` — Octokit 직접 호출 (createRepo, createBranch, commitAndPush, createPR, createIssue, mergeBranch, listRepos, listBranches)
- `createDeployProjectHandler` — GitHub 저장소에 프로젝트 파일 배포

## 승인 게이트 (`gates/approval-gate.ts`)

코드로 강제하는 단계별 승인 게이트. 에이전트 디스패치 도구 결과를 PO가 검토·승인해야 다음으로 진행한다.

- **모드**: `GateMode = 'manual' | 'auto'`. `GateConfig`(defaultMode + 단계별 overrides)는 세션별로 `session.store.ts`가 보관. `defaultMode`는 `task_request.payload.gateMode`(전역 게이트 모드 설정 UI)로 `setGateDefaultMode`에서 설정. `effectiveMode(config, stage)`가 단계 적용 모드를 결정 — 단, **배포는 항상 manual**.
- **대상**: `isGatedTool` = `GATED_TOOLS`(plan_task·design_ui·develop_code·run_tests·build_project·watch_changes·security_audit) ∪ `DEPLOY_TOOLS`(deploy_project, auto override 무시 — 항상 수동 승인). `KNOWLEDGE_BEARING_STAGES`(plan_task·design_ui·develop_code·security_audit)는 위키 저장이 의미 있는 단계.
- **결정 파싱**: `parseDecision(answer, failSafe=true)`가 `info_response.answer`(JSON)를 `GateDecision`(`approve{rememberAuto, saveToWiki, wikiSummary?}` | `revise{feedback}` | `abort` | `needs_human{reason}`)으로 해석. **fail-safe(기본)**: 파싱 불가·비객체·미지 decision 값은 자동 승인 대신 `needs_human`으로 에스컬레이션(시스템 결함은 approve가 아님). `failSafe=false`(env `MANAGER_GATE_FAILSAFE=false`)면 레거시 approve fail-open으로 복원. `wikiSummary`(PO가 저장 전 편집한 요약)는 비어있지 않은 문자열일 때만 채택(2000자 클램프).
- **요약**: `summarizeOutput(stage, result)` — content 우선, 없으면 직렬화(2000자 상한).
- **runner 게이트 훅** (`runner.ts` `applyApprovalGate`, 공통 후처리 `finalizeAgentResult` 경유): manual이면 `info_request`(`approval: { stage, summary, mode }`) 발행 후 `waitForInfo`로 대기.
  - `approve` → 결과 반환. `rememberAuto: true`면 해당 단계 override를 auto로 전환. `saveToWiki: true`면 `saveApprovedDecision`으로 승인 결정을 위키에 누적(`wikiSummary` 있으면 그 편집본을 우선 저장).
  - `revise` → 피드백을 `clarificationContext`로 추가해 재실행 후 재게이트 (`MANAGER_MAX_GATE_REVISES` 상한). **fail-safe면 소진 시 무음 통과 대신 에스컬레이션**(`onReviseExhausted`); 레거시면 마지막 산출물 반환.
  - `abort` → 세션 abort + `GateAbortError` throw(루프 종료, `escalateGate` 공통).
  - **`needs_human`(fail-safe)** → 자동 승인 금지. 같은 산출물로 **사유와 함께 사람에게 재요청**(`reaskNotice`, 에이전트 재실행 아님). `MAX_GATE_REASKS`(`MANAGER_MAX_GATE_REASKS`, 기본 3) 초과 시 에스컬레이션(`assertReaskWithinCap`). 상한 env는 `parsePositiveInt`로 NaN/0/음수 방어(잘못된 값이 fail-safe 상한을 무력화하지 못하도록).
  - **재실행 경로도 동일 게이트 적용(#216)**: 명확화·교차질의로 재실행(`reExecuteWithContext`)된 산출물도 `finalizeAgentResult`를 거쳐 승인 게이트를 우회하지 않는다(`GateAbortError`는 재던져 세션 종료 보존).

## 도메인 위키 (`db/knowledge.repo.ts` · `api/knowledge.route.ts`)

프로젝트 단위 도메인 지식(`domain_knowledge`)을 누적·재주입해 에이전트 간 지식을 공유한다.

- **타입**: `KnowledgeEntry`(쓰기: content·sourceAgent·category?) / `KnowledgeRecord`(읽기: + id).
- **runner 통합** (`runner.ts`):
  - 호출 전 `injectDomainKnowledge` — `recentByProject`로 최근 지식을 도구 입력 `context.domainKnowledge`로 주입(`MANAGER_WIKI_INJECT_LIMIT`).
  - 게이트 통과 후 `storeDomainKnowledge` — 결과의 `knowledge[]`(문자열 또는 `{content, category}`)를 sourceAgent=도구명으로 `insertMany`.
  - `saveApprovedDecision` — 게이트 approve+saveToWiki 시 승인 결정 요약(PO가 편집한 `wikiSummary` 우선, 없으면 자동 summary)을 sourceAgent=`approval-gate`·category=`decision`으로 저장(지식성 단계 한정).
  - 위키 주입/저장은 모두 비차단(repo·projectId 없거나 실패 시 작업 계속).
- **HTTP 라우트**: `GET /projects/:projectId/knowledge`(limit·q·source·category 필터, **비인증·읽기**), `PATCH /:id`(content·category 갱신), `DELETE /:id`. **쓰기(PATCH/DELETE)는 `authHook` 설정 시 서비스 JWT 필요**(#213 defense-in-depth; `SERVICE_JWT_SECRET` 미설정 시 개방·하위호환). PATCH/DELETE는 project_id 가드(repo)로 타 프로젝트 행 변조 차단.

## 세션 이벤트소싱 + 트랜잭셔널 아웃박스 (P0)

dual-write 제거 + 크래시 후 복원의 토대(senario M4/M5/M7). `EVENT_SOURCED_SESSION`(기본 false) flag로 가역. off/no-`DATABASE_URL`이면 기존 인메모리+fire-and-forget 경로 100% 보존.

- **스키마(`006_events_outbox.sql`)**: `manager_events`(append-only 진실원천 — event_id·session_id·event_type·payload·correlation_id·causation_id·idempotency_key·actor(nullable, #6/#7 가역)·occurred_at) + `manager_outbox`(event_id FK·stream·message·published_at). 코드 규약으로 events INSERT만(UPDATE/DELETE 없음).
- **`db/event-store.ts` `EventStore`**: `appendSessionEvent(input, stream)` — **단일 tx**로 events+outbox INSERT(M5, dual-write 0). 봉투(#239 `makeEnvelope`)로 correlation(=sessionId)·causation(=직전 eventId)·idempotency 채움(M7). `replaySessions()` — 전 이벤트 seq순 fold → 세션별 `{state, lastEventId, count}`.
- **`streams/outbox-relay.ts` `OutboxRelay`**: `setInterval`(`MANAGER_OUTBOX_POLL_MS`, 기본 500ms) 폴러 — 미발행 outbox(`FOR UPDATE SKIP LOCKED`)를 `StreamProducer.publishRaw`로 `manager:events:{sessionId}`에 발행 후 `published_at` 설정. **at-least-once**(멱등 소비·DLQ는 P1). 실패 시 pending 유지·`attempts++`.
- **`SessionStore` 컴포지션**: optional `eventStore`. 전이 메서드(create/resolveInfo/abort/delete) **async화** — event-sourced면 `appendEvent` 후 Map(투영) 갱신. `waitForInfo`는 resolver를 await 전 동기 설치(동기 패턴 보존). `restoreSession`으로 replay 결과 주입. 영속 대상=`state`·존재만; AbortController·infoResolve는 휘발 런타임(replay 시 새로 생성).
- **배선(`server.ts`)**: flag on + `DATABASE_URL`이면 `EventStore` 생성 → 시작 시 `replaySessions()` 복원 → `OutboxRelay.start()`. `closeAll`에서 relay stop.
- **게이트 연동**: `escalateGate`가 async `abort`를 await(중단 이벤트 기록 후 GateAbortError). narrowing은 abort 분기 `return this.escalateGate(...)`로 보존.
- **수용기준**: ①상태+이벤트 원자성(append 단일 tx·롤백) ②강제종료 후 replay 복원 ③correlation/causation — 실 pg 통합 테스트(`test/event-sourcing.integration.test.ts`, skip-if-no-DB)로 실증.

## Task Graph 영속 (P1d-3)

P1d Task Manager의 영속 토대. `EVENT_SOURCED_SESSION`과 무관하게 `runMigrations`가 항상 적용(빈 표는 무해), 소비·디스패치 배선은 후속(P1d-2/4).

- **스키마(`007_task_graphs.sql`)**: `task_graphs`(workflow_id PK·graph_dag JSONB={workPackages}·event_id nullable·version — **가변 프로젝션**, 재분해 시 upsert version++) + `wp_state_log`(seq BIGSERIAL·workflow_id·wp_id·from_state·to_state·event_id·reason·occurred_at — **append-only 전이 로그**, 코드 규약 INSERT만).
- **`db/task-graph.repo.ts` `TaskGraphRepo`**: `upsertGraph`(ON CONFLICT version++)·`getGraph`(graph_dag.workPackages를 WorkPackageSchema로 재검증)·`appendTransition`(INSERT only)·`latestStates`(DISTINCT ON wp_id seq DESC)·`transitions`(seq ASC). graph_dag는 노드 소스(WorkPackage[])만 저장 — 인접 그래프는 소비자가 `buildTaskGraph`로 파생. pg BIGSERIAL/BIGINT은 문자열 반환이라 `Number()` 변환.

## Task Graph 소비 (P1d-2)

`decomposition.emitted`(PM이 emit한 WP DAG)를 **결정론적으로** 소비. 생산자(PM 분해=P2)·구독 생명주기 미도착이라 **런타임 미배선**(소비 코어+테스트만, server.ts 무수정).

- **`streams/decomposition-consumer.ts`**: `handleDecompositionEmitted(msg, {repo, publish, ...})` 순수 핸들러 — `buildTaskGraph`(#253)로 빌드 → **구조오류(중복id·dangling)·사이클(detectCycle)이면** `decomposition.inconsistent` 발행 + 영속 안 함(LLM 수선 없음 — 사양 §6 결정론 경계, 수선은 PM/P2 책임) → **정상이면** `TaskGraphRepo.upsertGraph`(#255). `DecompositionConsumer`는 BaseConsumer 서브클래스(dedup ON·전송 글루).
- **스트림(잠정)**: 입력 `manager:decomposition:{workflowId}`(group `manager-taskgraph-consumers`), inconsistent 출력 `manager:events:{workflowId}`. P2 배선 시 확정.

## Task Graph 디스패치 (P1d-4)

영속 그래프에서 **ready 노드를 결정론적으로 디스패치**한다(`readyNodes`→`wp.dispatched`·step-N·상태전이 로깅). 생산자·트리거 미도착이라 **런타임 미배선**(코어+테스트만, server.ts 무수정). PO 결정: DRAFTED→DISPATCHED·step-N=topo 인덱스·트랜잭셔널 아웃박스(M5).

- **`streams/dispatch.ts`**: `planDispatch(graph, {alreadyDispatched, readiness?})` **순수** 플래너 — `readyNodes`(DoR) ∩ `!alreadyDispatched`, `topoSort.order` 인덱스로 step-N 부여(상태명 비의존). `handleDispatch(workflowId, {repo, store, readiness?})` 오케스트레이션 — `getGraph`→`latestStates`로 `alreadyDispatched`(toState==='DISPATCHED') 파생→`planDispatch`→항목별 원자 `recordDispatch`. 그래프 없음=noop. handleDecompositionEmitted 대칭.
- **`db/dispatch.repo.ts` `DispatchStore.recordDispatch`**: **단일 tx**로 `manager_events`(wp.dispatched 진실원천)+`wp_state_log`(DRAFTED→DISPATCHED 전이)+`manager_outbox`(M5)를 INSERT. `manager_outbox.event_id`→`manager_events` FK(006)를 한 tx로 충족. ROLLBACK 가드(연결 손상 시 원본 오류 보존). 기존 `OutboxRelay`가 `manager:events:{wf}`로 at-least-once 발행. EventStore.appendSessionEvent와 동일 메커니즘.
- **`streams/dispatch-constants.ts`**: `DRAFTED_STATE`·`DISPATCHED_STATE`·`WP_DISPATCHED_EVENT`·`DISPATCH_ACTOR` 단일출처(플래너·repo 공유, contract-drift 회피).
- **멱등·복원력**: 이미 DISPATCHED인 WP는 `alreadyDispatched`로 제외(per-WP tx라 부분 실패도 latestStates로 resumable). P1d-4 §8 한계(멱등키 위치 의존·동시성 dedup)는 **P1d-5a에서 해소**(아래 WP Lease).

## WP Lease (P1d-5)

디스패치된 WP에 **가시성 타임아웃 lease**를 부여하고, 만료 시 reclaim(재할당 attempt++)→상한 초과 시 escalate한다. **미배선 코어**(sweep 타이머·wp.completed 흐름·server.ts 배선은 후속). PR 분할: **5a**(lease 획득 on dispatch + §8 하드닝) / **5b**(reclaim·escalate sweep). 설계 스펙 [2026-06-08-p1d5-lease-escalation-design.md](../../docs/superpowers/specs/2026-06-08-p1d5-lease-escalation-design.md).

- **migration 008 `wp_leases`**: `(workflow_id, wp_id)` PK(가변 프로젝션·1행/WP)·`attempt`·`owner`(nullable)·`status`(active/released/escalated)·`expires_at`·`step_n`·`event_id`. **PK가 §8 #2 동시 dispatch dedup 게이트**.
- **`recordDispatch`(5a)**: 같은 tx에 **`wp_leases` INSERT ON CONFLICT (wf,wp) DO NOTHING**(0행=이미 lease → ROLLBACK+`{status:'deduped'}`) + `appendWpEvent`(공통 헬퍼: manager_events+wp_state_log+outbox). **§8 #1 해소**: 멱등키를 `{wf}:wp-${wpId}:${attempt}`로 **WP 고정**(재분해 무관·attempt별), step-N은 payload 표시용. `expires_at=occurredAt+visibilityMs`(`DEFAULT_VISIBILITY_MS` 5분).
- **`handleDispatch`(5a)**: `visibilityMs` 전달·`deduped`는 dispatched 제외·`skipped` 집계.
- **`db/lease.repo.ts` `LeaseStore`(5b)**: `expiredActiveLeases`(status='active' AND expires_at<now)·`getLease`·원자 `recordReclaim`(lease UPDATE attempt++·새 만료 + wp.dispatched(attempt next) 단일 tx)·`recordEscalation`(status='escalated' + wp.escalated·ESCALATED 전이). `appendWpEvent`(5a) 재사용. **동시 sweep 직렬화**: reclaim=`AND attempt=$expected` **CAS**(reclaim은 status를 active로 유지하므로 status 가드만으론 이중 reclaim 미차단), escalate=status 단방향 전이. escalate는 lease.event_id 미갱신(dispatch provenance 보존).
- **`streams/lease.ts`(5b)**: `planReclaim(expired, {maxAttempts})` **순수**(nextAttempt<maxAttempts→reclaim / 아니면 escalate)·`handleLeaseSweep(now, {store, maxAttempts?, visibilityMs?})`(expiredActiveLeases→planReclaim→항목별 recordReclaim/Escalation, outcome reclaimed/escalated/skipped). 실제 sweep 타이머 구동은 후속(server.ts 배선). `DEFAULT_MAX_ATTEMPTS=3`·`DEFAULT_VISIBILITY_MS=5분`(env `MANAGER_LEASE_MAX_ATTEMPTS`·`MANAGER_LEASE_VISIBILITY_MS` 오버라이드, 배선 시).

## WP 완료 흐름 (P1d-6)

WP 완료 시 lease release + 완료 전이(DISPATCHED→DONE) + **후행 unblock 재디스패치**로 디스패치 루프(dispatch→lease→complete→re-dispatch)를 닫는다. 미배선 코어(실제 완료 신호·server.ts 배선 후속). PO 결정: DISPATCHED→DONE·lease released·active lease만 완료·handleDispatch 재사용.

- **`LeaseStore.recordCompletion`**: lease `status='released'`(WHERE status='active' 가드·active lease만 완료·동시 완료 직렬화) + `wp.completed`(DISPATCHED→DONE) 단일 tx(`transition` 재사용). lease.event_id 미갱신(provenance).
- **`streams/completion.ts` `handleCompletion(workflowId, wpId, {leaseStore, dispatch})`**: getLease(비active→skip)→recordCompletion(skip이면 재디스패치 안 함)→`handleDispatch` 재디스패치. outcome `{status, dispatched, eventId?}`.
- **`handleDispatch` 수정(P1d-6)**: DoR done 판정을 정적 graph_dag status가 아니라 **`latestStates`의 to_state='DONE'에서 파생**(완료가 후행 실제 unblock). `alreadyDispatched`=DISPATCHED∪ESCALATED(escalated 재디스패치 금지). 주입 isDone은 **합성**(DONE 항상 done 보존). **회귀 0**(DONE 없는 기존 경로 동작 불변).
- ⚠️ **배선 전 해소(스펙 §8)**: WP 생명주기 이벤트(dispatched/completed/escalated)가 같은 (wpId,attempt) 멱등키 공유 → P1d-7 소비자 dedup은 event_id 또는 event_type 포함 필요. recordCompletion stale-attempt(TOCTOU)는 provenance만·active 가드로 무해.

## Task Manager Supervisor 런타임 배선 (P1d-7)

P1d-1~6의 핵심 핸들러를 `Supervisor`로 묶어 server.ts에 **flag(`TASK_MANAGER_ENABLED`, 기본 false·가역) 뒤로 배선**한다. 생산자(P2 분해·워커 완료 신호) 미도착이라 빈 스트림 구독이지만 동작 준비 완료(lease sweep은 즉시 유효). off면 핸들러만 존재(미배선·회귀 0). 설계 스펙 [2026-06-08-p1d7-supervisor-design.md](../../docs/superpowers/specs/2026-06-08-p1d7-supervisor-design.md).

- **`streams/supervisor.ts`**: `Supervisor`(생명주기 코디네이터 — decomposition 소비·completion 소비·lease sweep을 start/stop, 주입 컴포넌트라 테스트 용이; start는 consumer.start reject를 `.catch` 관측)·`createSupervisor(makeRedis, deps, config)`(실 컴포넌트 조립 — **소비자별 전용 Redis 연결** makeRedis 2회로 xreadgroup BLOCK 직렬화 회피)·`shouldWireSupervisor(enabled, hasPool)`(순수 게이트 wire/warn/skip)·`buildCompletionHandler`·`CompletionSignalSchema`(잠정).
- **`streams/lease-sweeper.ts`**: `LeaseSweeper`(setInterval→`handleLeaseSweep`, 재진입 가드·never-throw, OutboxRelay 패턴).
- **`streams/decomposition-consumer.ts`**: `buildDecompositionConsumerHandler`(영속→영속 성공 시 afterPersisted 훅)·`DecompositionConsumer` afterPersisted 인자 추가(additive·P1d-2 회귀 0). Supervisor가 afterPersisted=디스패치 주입.
- **`streams/redis.client.ts`**: `createRedisClient`(비공유 전용 연결)는 `dedicated` Set에 등록 → `closeRedisClients`가 Map+Set 모두 quit(누수 방지).
- **스트림(잠정)**: 입력 `manager:decomposition:main`·`manager:completions:main`(shared 단일·workflowId는 봉투). P2 배선 시 확정.
- **데이터 흐름**: decomposition→영속→디스패치(wp.dispatched+lease) / 30s sweep→만료 reclaim/escalate / completion→lease release·DONE·후행 재디스패치. 발행은 OutboxRelay 경유.

## AgentQuery 교차질의

에이전트가 작업 중 다른 에이전트에게 질의할 수 있다. 하위 에이전트가 `AgentQueryError`(to·question·kind: `active_request` | `cross_check`)를 throw하면 runner가 처리한다.

- `resolveAgentTool(err.to)`(`tools/agent-tool-map.ts`, **답변 가능 6개 에이전트명→도구명 매핑**)로 대상 도구를 찾아 `buildAgentQueryPayload(err)`로 실행.
- **`buildAgentQueryPayload`(runner.ts)**: 질의 모드는 `query`·`context`만 읽지만(`collaboration.ts`가 `runMain` 미호출), 답변자 `ManagerTo{Agent}MessageSchema`는 요청 모드 필수 필드를 갖는다. 전 답변자(planner·designer·tester·builder·security·developer) 스키마 **필수 필드 합집합**(`context`·`intent`·`priority`·`projectPath`·`target`·`severity`·`artifacts`)을 placeholder로 채워 어느 답변자로 라우팅돼도 `safeParse` 실패(→ invalid_schema DLQ → 120초 타임아웃)를 막는다. Zod object는 미정의 키를 strip하므로 무해. `intent`는 planner/designer `.min(1).max(4000)` 제약에 맞춰 4000자 클램프 + 빈 질문 폴백.
- **watcher는 교차질의 대상에서 제외**(`AGENT_TO_TOOL`에 미포함): Claude 미사용·답변 불가이고, 라우팅 시 watch_changes 스키마 검증 실패(triggers 필수)로 타임아웃·실제 파일 감시 부작용이 나므로 `resolveAgentTool('watcher')`=undefined → 즉시 `is_error` 거부.
- 대상 응답을 `clarificationContext`(JSON)로 넘겨 `reExecuteWithContext`로 질의한 에이전트를 재실행.
- 미지·답변 불가 대상·질의 실패 시 `is_error` tool_result로 폴백(루프 계속).

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3001
MODE=local
GITHUB_TOKEN=            # 선택: 설정 시 github_ops 핸들러 활성화
SERVICE_JWT_SECRET=      # 선택: 설정 시 JWT 인증 활성화 (32자 이상 필수)
DATABASE_URL=            # 선택: DB 연결 문자열
MANAGER_GATE_FAILSAFE=   # 선택: 기본 true. 'false'면 승인 게이트 레거시 fail-open 복원
MANAGER_MAX_GATE_REASKS= # 선택: needs_human 재요청 최대 횟수(기본 3), 초과 시 세션 중단
EVENT_SOURCED_SESSION=   # 선택: 기본 false. true면 Postgres 이벤트소싱 진실원천 사용(DATABASE_URL 필요)
MANAGER_OUTBOX_POLL_MS=  # 선택: 아웃박스 릴레이 폴링 주기 ms(기본 500)
TASK_MANAGER_ENABLED=    # 선택: 기본 false. true+DATABASE_URL이면 Task Manager Supervisor 배선(P1d-7)
MANAGER_LEASE_SWEEP_MS=  # 선택: lease 만료 sweep 주기 ms(기본 30000)
MANAGER_LEASE_VISIBILITY_MS= # 선택: lease 가시성 타임아웃 ms(기본 300000)
MANAGER_LEASE_MAX_ATTEMPTS=  # 선택: 최대 디스패치 시도, 초과 시 escalate(기본 3)
MANAGER_DECOMPOSE_ENABLED=   # 선택: 기본 false. true면 decompose_request 분해 생산자 배선(P2-2)
```

## 보안 구현 패턴

공통 보안 패턴: [docs/development/security-patterns.md](../../docs/development/security-patterns.md)

- **Redis 메시지 검증**: `consumer.ts`는 `OrchestratorToManagerMessageSchema.safeParse()` 로 모든 수신 메시지 검증. 실패 시 xack 후 skip
- **sessionId 검증**: `sessions.route.ts`에서 `z.string().uuid()` 검증 — UUID 형식 외 요청은 400 반환
- **JWT 인증**: `SERVICE_JWT_SECRET` 설정 시 JWT 인증 활성화 — 32자 미만이면 `superRefine`으로 시작 거부 (`config.ts`). `verifyServiceToken`은 `@fastify/jwt` 에러 코드별로 응답 메시지 분기: `FST_JWT_NO_AUTHORIZATION_IN_HEADER` → 401 `Missing token`, `FST_JWT_AUTHORIZATION_TOKEN_EXPIRED` → 401 `Token expired`, 그 외 → 401 `Invalid token`
- **github-ops 경로 검증**: `commitAndPush`의 `files[].path`는 `validateCommitPath()`로 검증 — `..`, 제어문자, `.github/workflows/` 경로 차단
- **Claude tool-use 검증**: `runner.ts`의 `block.input`은 각 핸들러의 `inputSchema`로 디스패치 전 선검증 (완료 — `validate-tool-input.ts`, #219). 검증 실패 시 디스패치 없이 `is_error` tool_result 반환
- **AbortController 재사용** (`session.store.ts`): `abort()` 후 즉시 `new AbortController()` 교체 — `AbortSignal`은 단방향이므로 재사용 불가
- **무한루프 방지** (`runner.ts`): 빈 `toolResults` 배열 가드 + `stop_reason`이 `end_turn`/`tool_use` 외면 `throw` — `max_tokens` 등 예상치 못한 종료 시 즉시 실패
- **noUncheckedIndexedAccess 호환 필드 접근** (`streams/consumer.ts`): `string[]` 인덱싱 결과는 `string | undefined` — `fields[idx]!` 단언 대신 명시적 `if (rawStr === undefined) return null` 가드 사용 (S4325)

## 시스템 위치

```
사용자 → Electron 앱 → xzawedOrchestrator (3000) → [Redis] → xzawedManager (3001)
                                                                    ↓ ToolHandler
                                          Planner / Developer / Designer / Tester / Builder / Watcher / Security
```

관련 프로젝트: 현재 저장소 루트 — 전체 9개 서비스 모두 구현 완료
