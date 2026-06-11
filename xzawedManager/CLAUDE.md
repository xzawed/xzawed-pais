# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedManager(총관리자)는 xzawed 멀티 에이전트 시스템의 **두 번째 계층**이다.  
xzawedOrchestrator로부터 Redis Streams로 작업 지시를 수신하고, Claude tool-calling 루프를 통해 처리한 뒤 결과를 반환한다.

현재 상태: **구현 완료 (server 687/717 테스트 — 로컬 30 skip, CI는 pg 통합 27건 포함 714/717 실행)**

> **통합 테스트 게이트**: `test/*.integration.test.ts`는 `TEST_DATABASE_URL ?? DATABASE_URL`로 게이트(CI turborepo 잡이 `TEST_DATABASE_URL` 주입 — 이전엔 `DATABASE_URL`만 읽어 **CI에서 한 번도 실행되지 않았음**). cleanup은 전부 파일별 prefix 스코프(`wf-comp-`·`wf-disp-`·`wf-lease-`·`wf-dc-`·`wf-tgp-`·`wf-ew-`·`wf-orc-`·`es-it`) — 비스코프 DELETE는 병렬 형제 테스트의 행을 지워 간헐 실패를 만든다. `runMigrations`는 pg advisory lock으로 동시 실행 직렬화(병렬 테스트·다중 인스턴스 기동 공통 방어). — 8개 ToolHandler 모두 `RedisAgentHandler` 또는 직접 Octokit 기반으로 구현. 코드로 강제하는 승인 게이트(`gates/`, **fail-safe 포함**)·프로젝트 도메인 위키(`db/knowledge.repo.ts`·`api/knowledge.route.ts`)·AgentQuery 교차질의 라우팅·**세션 이벤트소싱+아웃박스**(`db/event-store.ts`·`streams/outbox-relay.ts`, flag 가역) 추가. JWT 인증 미들웨어 에러 코드 분기 추가. Redis 계약 통합 테스트는 `REDIS_URL` 없으면 skip. consumer.ts Redis 단절 복구(xreadgroup try/catch) + xack try/finally 보장. runner.ts request_info 누락 필드·빈 tool_use 블록 입력 검증 추가.

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
        ├── streams/            # Redis consumer + producer + outbox-relay.ts(아웃박스→Redis 폴링 릴레이) + outbox-publish.ts(**하드닝: createOutboxPublish** — 봉투 메시지를 manager_events+manager_outbox 단일 tx 적재하는 `DecomposePublish`, decompose emission을 raw 발행 대신 트랜잭셔널 아웃박스 경유로 at-least-once·truth-source 정합). StreamConsumer·SessionGatewayConsumer(P1c-3)·StreamProducer·WatcherEventConsumer(P1c-4, readGroupMulti)·RedisAgentHandler·switch-project·register-project(P1c-5, RequestReplyPort RPC 라운드트립)는 전송을 @xzawed/agent-streams RedisEventBus(EventBus/StreamConsumerPort/RequestReplyPort)에 위임. RedisAgentHandler ensureSessionStream(xgroup)·notifyGateway는 잔류(후속). DecompositionConsumer(P1d-2, decomposition.emitted→TaskGraph 빌드·영속, 미배선). dispatch.ts(P1d-4 planDispatch 순수+handleDispatch 오케스트레이션, P1d-6 done-set 파생, **P3-1 oracleStore 주입→satisfied-set DoR**, **P4-1 publish 주입 시 wp.dispatch_signal 발행**)·lease.ts(P1d-5b planReclaim 순수+handleLeaseSweep, **P4-1 reclaim 시 wp.dispatch_signal 발행**)·completion.ts(P1d-6 handleCompletion: 완료→재디스패치)·oracle-consumer.ts(P3-1 buildOracleApprovedHandler·OracleApprovedSchema: oracle.approved→재디스패치)·dispatch-signal.ts(**P4-1 wp.dispatch_signal 트리거 계약**: WpDispatchSignalSchema·publishDispatchSignal·DISPATCH_SIGNAL_STREAM='manager:dispatched:main'·멱등키 wpId 고정·dispatch/lease/worker 공유)·worker.ts(**P4-1 실행 워커**: handleWpDispatchSignal·buildWorkerInput·shouldWireWorker·WorkerConsumer·AgentExecutor; **P4b-1 verifyEnabled 검증 게이트**)·verify.ts(**P4b-1 실 검증 코어**: judgePrimaryResult·planVerificationChecks·verifyWp·publishVerificationFailed — fail-closed)·lease-sweeper.ts(P1d-7 LeaseSweeper 타이머, P4-1 publish 스레딩)·supervisor.ts(P1d-7 Supervisor 생명주기·createSupervisor·shouldWireSupervisor·buildCompletionHandler, **P3-1 oracleConsumer 조건부 배선**, **P3-2 shouldWireOracleConsumer 순수 게이트·SupervisorConfig.oracleDor·oracleStore를 decompositionConsumer에 upsertDraft용 주입**, **P4-1 shouldWireWorker·SupervisorConfig.taskWorker·workerConsumer 조건부 배선·dispatch/leaseSweeper에 publish 합류**)·dispatch-constants.ts(디스패치/lease/완료 상태·이벤트 상수 단일출처). **P1d-7부터 `TASK_MANAGER_ENABLED`+DATABASE_URL이면 server.ts에 Supervisor 배선(이전 미배선 핸들러 가동)**
        ├── decompose/          # decompose/(map.ts·pipeline.ts·producer.ts·trigger.ts·stages/) — **P2-3a 다단계 분해 생산자**: decompose_request→4단계 LLM 분해(epics→vertical slice→독립 deliverables→roles)→커버리지 매트릭스 보고(로그 전용)·**P4 repair 루프(K회·수렴 시 진행·소진 시 decomposition.inconsistent 에스컬레이션)**·**세로슬라이스 소프트 린트(로그)**→content-hash WP[]→decomposition.emitted 발행(`MANAGER_DECOMPOSE_ENABLED` flag, off면 회귀 0; Supervisor가 소비). **하드닝: pool 있으면 발행을 `createOutboxPublish`(트랜잭셔널 아웃박스) 경유 — emission이 크래시·전송실패에도 재발행되는 at-least-once·이벤트소싱 truth-source 정합(M5/M7), pool 없으면 raw 발행 강등(경고). producer 코드 무수정(`publish` 배선만 교체)·OutboxRelay 조건에 DECOMPOSE 추가.** **P3-2: `stages/draft-oracles.ts`(draftOracles — ok 경로에서 story별 GWT 시나리오 초안 생성·미커버 AC stub 보장·`MAX_SCENARIOS_PER_STORY=8` 상한·oracleId 미부여)·pipeline `runDecomposition(...,draftEnabled)`·producer가 oracleDrafts를 ok 경로 payload에 additive emit(`MANAGER_ORACLE_DRAFT` flag)**
        ├── claude/runner.ts    # Claude tool-calling 루프 (승인 게이트·위키 주입/저장·AgentQuery 라우팅)
        ├── gates/              # approval-gate.ts: 게이트 모드·대상·결정 파싱
        ├── db/                 # knowledge.repo.ts + session.repo.ts + event-store.ts(이벤트소싱 append+replay) + task-graph.repo.ts(P1d-3 Task Graph 영속) + dispatch.repo.ts(P1d-4 디스패치 원자 적재 + P1d-5a lease 획득·dedup·appendWpEvent) + lease.repo.ts(P1d-5b LeaseStore 만료 조회·reclaim·escalate + P1d-6 recordCompletion) + oracle.types.ts(P3-1 OracleSchema·OracleScenarioSchema·coveredCriteria; **P3-2 given/when/thenSteps 시나리오 필드(Gherkin 'Then'은 thenable 함정 회피 위해 `thenSteps`)·OracleDraftSchema(oracleId 없음)·`oracleIdFor(wf,storyId)` 충돌-회피 해시 파생·**P4b-3 OracleInvariantSchema(§4)·OracleGoldenSchema(§5)·OracleSchema invariants/goldenRefs additive default []**) + oracle.repo.ts(P3-1 OracleRepo: approve 단일 tx·approvedByWorkflow·upsert·listByWorkflow; **P3-2 upsertDraft(멱등 pending·oracleIdFor 단일출처)·approve가 drafted→human_approved 일괄 전이+pending 가드**·**P4b-3 upsert가 invariants/golden_refs 영속·approve/upsertDraft는 보존**) + pool.ts + migrations/(001~010·010 oracle invariants/golden_refs additive)
        ├── tools/              # ToolHandler 11개 (7 RedisAgent + register-project + switch-project + github-ops* + deploy-project* / *GITHUB_TOKEN 조건부) + agent-tool-map.ts + errors.ts
        ├── sessions/           # 세션 상태 추적 (session.store.ts: gateConfig·waitForInfo·게이트 override·EventStore 컴포지션)
        └── api/                # health 라우트 + knowledge.route.ts(GET 비인증·읽기; PATCH/DELETE는 authHook 설정 시 서비스 JWT 필요) + oracle.route.ts(P3-1 POST 생성·PATCH approve·GET 조회; 쓰기는 authHook 설정 시 보호)
```

## Redis Streams 인터페이스

**수신:** `orchestrator:to-manager:{sessionId}` (consumer group: `manager-consumers`)
| type | 처리 |
|---|---|
| `task_request` | Claude tool-calling 루프 시작. `payload.gateMode`(`manual\|auto`) 있으면 세션 기본 승인 모드로 적용(`setGateDefaultMode`) |
| `info_response` | 대기 중 루프 재개. `answer`가 승인 게이트 응답이면 JSON 결정(`{decision: approve\|revise\|abort, rememberAuto?, saveToWiki?, wikiSummary?, feedback?}`)으로 해석 (`parseDecision`) |
| `abort` | 루프 즉시 중단 |
| `decompose_request` | `payload.intent` → flag on(`MANAGER_DECOMPOSE_ENABLED`)이면 4단계 LLM 분해+P4 repair 루프(소진 시 에스컬레이션)→decomposition.emitted 발행(Supervisor 소비). flag off면 분기 무시. `payload.userContext`(optional, P4a-2) 있으면 `ensureWorkspace` 후 그래프에 영속→실행 워커 주입 |

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
- **배선(`server.ts`)**: `EVENT_SOURCED_SESSION` + `DATABASE_URL`이면 `EventStore` 생성 → 시작 시 `replaySessions()` 복원. **`OutboxRelay`는 아웃박스를 쓰는 어떤 flag(`EVENT_SOURCED_SESSION`·`TASK_MANAGER_ENABLED`·`MANAGER_ORACLE_DOR`·`MANAGER_ORACLE_DRAFT`·`MANAGER_DECOMPOSE_ENABLED`)라도 켜지면 가동**(아웃박스→Redis 발행은 이벤트소싱과 독립 — 미기동 시 wp.dispatched·oracle.approved·decomposition.emitted 행이 잔류해 디스패치/재디스패치/소비 불발). `closeAll`에서 relay stop.
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
- **`recordDispatch`(5a)**: 같은 tx에 **`wp_leases` INSERT ON CONFLICT (wf,wp) DO NOTHING**(0행=이미 lease → ROLLBACK+`{status:'deduped'}`) + `appendWpEvent`(공통 헬퍼: manager_events+wp_state_log+outbox). **§8 #1 해소**: 멱등키를 `{wf}:wp-${wpId}:${attempt}:${eventType}`로 **WP+event_type 고정**(재분해 무관·attempt별·생명주기 이벤트 분리 — `appendWpEvent`가 event_type 덧붙임), step-N은 payload 표시용. `expires_at=occurredAt+visibilityMs`(`DEFAULT_VISIBILITY_MS` 5분).
- **`handleDispatch`(5a)**: `visibilityMs` 전달·`deduped`는 dispatched 제외·`skipped` 집계.
- **`db/lease.repo.ts` `LeaseStore`(5b)**: `expiredActiveLeases`(status='active' AND expires_at<now)·`getLease`·원자 `recordReclaim`(lease UPDATE attempt++·새 만료 + wp.dispatched(attempt next) 단일 tx)·`recordEscalation`(status='escalated' + wp.escalated·ESCALATED 전이). `appendWpEvent`(5a) 재사용. **동시 sweep 직렬화**: reclaim=`AND attempt=$expected` **CAS**(reclaim은 status를 active로 유지하므로 status 가드만으론 이중 reclaim 미차단), escalate=status 단방향 전이. escalate는 lease.event_id 미갱신(dispatch provenance 보존). **하드닝 `renewLease`(하트비트)**: 실행 중 lease 가시성 연장(`expires_at=now+visibilityMs`·`status='active' AND attempt` CAS) — reclaim(attempt++)·escalate·release된 stale lease는 0행(stale 워커가 남의 lease 연장 차단). 가시성 연장만이라 events/outbox 미적재(진실원천 전이는 reclaim/escalate/complete 소유).
- **`streams/lease.ts`(5b)**: `planReclaim(expired, {maxAttempts})` **순수**(nextAttempt<maxAttempts→reclaim / 아니면 escalate)·`handleLeaseSweep(now, {store, maxAttempts?, visibilityMs?})`(expiredActiveLeases→planReclaim→항목별 recordReclaim/Escalation, outcome reclaimed/escalated/skipped). 실제 sweep 타이머 구동은 후속(server.ts 배선). `DEFAULT_MAX_ATTEMPTS=3`·`DEFAULT_VISIBILITY_MS=5분`(env `MANAGER_LEASE_MAX_ATTEMPTS`·`MANAGER_LEASE_VISIBILITY_MS` 오버라이드, 배선 시).

## WP 완료 흐름 (P1d-6)

WP 완료 시 lease release + 완료 전이(DISPATCHED→DONE) + **후행 unblock 재디스패치**로 디스패치 루프(dispatch→lease→complete→re-dispatch)를 닫는다. 미배선 코어(실제 완료 신호·server.ts 배선 후속). PO 결정: DISPATCHED→DONE·lease released·active lease만 완료·handleDispatch 재사용.

- **`LeaseStore.recordCompletion`**: lease `status='released'`(WHERE status='active' 가드·active lease만 완료·동시 완료 직렬화) + `wp.completed`(DISPATCHED→DONE) 단일 tx(`transition` 재사용). lease.event_id 미갱신(provenance).
- **`streams/completion.ts` `handleCompletion(workflowId, wpId, {leaseStore, dispatch})`**: getLease(비active→skip)→recordCompletion(skip이면 재디스패치 안 함)→`handleDispatch` 재디스패치. outcome `{status, dispatched, eventId?}`.
- **`handleDispatch` 수정(P1d-6)**: DoR done 판정을 정적 graph_dag status가 아니라 **`latestStates`의 to_state='DONE'에서 파생**(완료가 후행 실제 unblock). `alreadyDispatched`=DISPATCHED∪ESCALATED(escalated 재디스패치 금지). 주입 isDone은 **합성**(DONE 항상 done 보존). **회귀 0**(DONE 없는 기존 경로 동작 불변).
- ✅ **§8 해소(하드닝)**: WP 생명주기 이벤트(dispatched/completed/escalated)가 같은 (wpId,attempt) 멱등키를 공유하던 것을 `appendWpEvent`가 **event_type을 키에 덧붙여 분리**(키-기반 dedup 소비자가 같은 attempt의 후속 생명주기 이벤트를 유실하던 잠복 결함 봉합 — 예: wp.completed가 wp.dispatched 뒤로 skip). eventId는 randomUUID라 event_id 공유(lease provenance)는 불변. recordCompletion stale-attempt(TOCTOU)는 provenance만·active 가드로 무해.

## Task Manager Supervisor 런타임 배선 (P1d-7)

P1d-1~6의 핵심 핸들러를 `Supervisor`로 묶어 server.ts에 **flag(`TASK_MANAGER_ENABLED`, 기본 false·가역) 뒤로 배선**한다. 생산자(P2 분해·워커 완료 신호) 미도착이라 빈 스트림 구독이지만 동작 준비 완료(lease sweep은 즉시 유효). off면 핸들러만 존재(미배선·회귀 0). 설계 스펙 [2026-06-08-p1d7-supervisor-design.md](../../docs/superpowers/specs/2026-06-08-p1d7-supervisor-design.md).

- **`streams/supervisor.ts`**: `Supervisor`(생명주기 코디네이터 — decomposition 소비·completion 소비·lease sweep을 start/stop, 주입 컴포넌트라 테스트 용이; start는 consumer.start reject를 `.catch` 관측)·`createSupervisor(makeRedis, deps, config)`(실 컴포넌트 조립 — **소비자별 전용 Redis 연결** makeRedis 2회로 xreadgroup BLOCK 직렬화 회피)·`shouldWireSupervisor(enabled, hasPool)`(순수 게이트 wire/warn/skip)·`buildCompletionHandler`·`CompletionSignalSchema`(잠정).
- **`streams/lease-sweeper.ts`**: `LeaseSweeper`(setInterval→`handleLeaseSweep`, 재진입 가드·never-throw, OutboxRelay 패턴).
- **`streams/decomposition-consumer.ts`**: `buildDecompositionConsumerHandler`(영속→영속 성공 시 afterPersisted 훅)·`DecompositionConsumer` afterPersisted 인자 추가(additive·P1d-2 회귀 0). Supervisor가 afterPersisted=디스패치 주입.
- **`streams/redis.client.ts`**: `createRedisClient`(비공유 전용 연결)는 `dedicated` Set에 등록 → `closeRedisClients`가 Map+Set 모두 quit(누수 방지).
- **스트림(잠정)**: 입력 `manager:decomposition:main`·`manager:completions:main`(shared 단일·workflowId는 봉투). P2 배선 시 확정.
- **데이터 흐름**: decomposition→영속→디스패치(wp.dispatched+lease) / 30s sweep→만료 reclaim/escalate / completion→lease release·DONE·후행 재디스패치. 발행은 OutboxRelay 경유.

## Oracle DoR 게이트 (P3-1)

P2-3 분해로 영속된 WP가 `oracleRef=null`이라 `readyNodes=∅`·디스패치 0인 블로커를, **사람이 승인한 Oracle을 DoR 게이트에 반영**해 `ready→dispatched`를 처음으로 연다. `MANAGER_ORACLE_DOR`(기본 false) flag 뒤로 가역 — off면 기본 술어(`oracleRef!=null`)·회귀 0. 설계 스펙 [2026-06-09-p3-1-oracle-dor-gate-design.md](../../docs/superpowers/specs/2026-06-09-p3-1-oracle-dor-gate-design.md).

- **migration 009 `oracles`**: `oracle_id` PK·`workflow_id`·`story_id`·`version`·`status`(pending/approved/superseded)·`scenarios` JSONB·`coverage` JSONB(`{acceptance_criterion: [scenario_id]}`)·`approved_at`·`approved_by` — **가변 프로젝션**(진실원천은 manager_events `oracle.approved`). `idx_oracles_workflow_status`로 조회.
- **`db/oracle.types.ts`**: `OracleSchema`·`OracleScenarioSchema`(zod·기본값)·상수(`ORACLE_APPROVED_EVENT='oracle.approved'`·`ORACLE_STREAM='manager:oracle:main'`·`SCENARIO_APPROVED='human_approved'` 등)·`coveredCriteria(scenarios, coverage)`(§8: ≥1 human_approved 시나리오가 덮는 AC 집합→`ApprovedOracleView` 변환용).
- **`db/oracle.repo.ts` `OracleRepo`**: `approve(oracleId, approvedBy)` — **단일 tx**로 oracles UPDATE(status=approved, `status<>approved` 가드·0행이면 null) + `manager_events`(oracle.approved 진실원천) + `manager_outbox`(M5) INSERT 후 COMMIT(`DispatchStore.recordDispatch` 패턴·safeRollback). 멱등키 `{wf}:oracle.approved:{oracleId}:{version}`. `approvedByWorkflow`(satisfied-set 입력 `ApprovedOracleView[]`)·`upsert`(ON CONFLICT version++)·`listByWorkflow`.
- **`handleDispatch` 오라클 주입**: `DispatchDeps.oracleStore` 주입 시 디스패치마다 `approvedByWorkflow`로 approved 오라클 조회→`oracleSatisfiedSet`(shared 순수 코어)으로 satisfied-set 산출→`readiness.oracleSatisfied = (wp) => set.has(wp.id)` 주입(기본 술어 대체, **pull** 모델). 미주입(flag off)이면 정적 readiness 또는 기본 술어 — 회귀 0.
- **`streams/oracle-consumer.ts`**: `OracleApprovedSchema`(envelope+type+payload)·`buildOracleApprovedHandler(dispatch)` — `oracle.approved` 소비 시 `handleDispatch(envelope.workflowId, dispatch)`로 **재디스패치**(satisfied-set이 새 승인 반영). completion 핸들러 대칭.
- **Supervisor 배선**: `SupervisorComponents.oracleConsumer`(optional)·`SupervisorDeps.oracleStore`(optional). `createSupervisor`가 `oracleStore` 주입 시에만 dispatch deps에 합류 + `BaseConsumer`(group `manager-oracle-consumers`·prefix `manager:oracle`)로 oracleConsumer 조건부 생성→start/stop 배선. 미주입이면 throw 안 함(flag off).
- **`api/oracle.route.ts`**: `POST /workflows/:workflowId/oracles`(upsert·201)·`PATCH /oracles/:oracleId/approve`(approvedBy 필수→400, 미존재/이미 approved→404, 성공→200 `{ok, eventId}`)·`GET /workflows/:workflowId/oracles`(status 필터·repo 없으면 빈 목록). 쓰기는 `authHook` 설정 시 서비스 JWT 보호.
- **`server.ts` 배선**: `MANAGER_ORACLE_DOR`+`pool`이면 `createSupervisor`에 `oracleStore: new OracleRepo(pool)` 합류 + `oracleRoute`에 `oracleRepo` 주입 + **`OutboxRelay` 기동 조건에 포함**(`oracle.approved` 아웃박스→Redis 발행 필수 — 없으면 재디스패치 불발). flag off면 미배선.

## Oracle 초안 생성 (P3-2)

P3-1이 연 디스패치 게이트의 **사람 병목**(오라클 백지 작성)을 흡수한다. 분해가 산출한 각 Story에 PM(LLM)이 Given-When-Then 시나리오 **초안**을 생성해 `pending` 오라클로 영속하고, 사람은 PATCH approve 한 번으로 초안을 `human_approved`로 전이해 DoR을 충족시킨다. `MANAGER_ORACLE_DRAFT`(기본 false) flag 뒤로 가역 — off면 `oracleDrafts=[]`·스테이지 미호출·회귀 0. 설계 스펙 [2026-06-09-p3-2-oracle-draft-generation-design.md](../../docs/superpowers/specs/2026-06-09-p3-2-oracle-draft-generation-design.md). **새 migration 없음**(given/when/thenSteps는 `oracles.scenarios` JSONB 내부).

- **draft 스테이지(`decompose/stages/draft-oracles.ts`)**: `draftOracles(stories, deps)` — story별 `runStage`(LLM) 1회로 그 story의 `acceptanceCriteria`를 덮는 GWT 시나리오 초안 + coverage 생성. **커버리지 보장**: LLM 미커버 AC마다 stub 시나리오(`{id, title:AC, thenSteps:[AC], status:'drafted'}`) 합성, LLM 실패면 AC별 stub fallback. story당 LLM 시나리오 ≤ `MAX_SCENARIOS_PER_STORY`(8)로 절단(payload 10MiB 방어, blocker#7). scenario id=`{storyId}-sc{n}`(결정론). **oracleId는 producer가 부여하지 않음**(consumer가 파생, blocker#3·D1·D2).
- **스키마(additive)**: `OracleScenarioSchema`에 `given`/`when`/`thenSteps` 추가(Gherkin 'Then'은 속성명 `then`이 객체를 thenable로 만들어 `thenSteps`로 명명 — SonarCloud no-thenable; 전부 기본값→P3-1 회귀 0; satisfied-set은 status+coverage만 소비, GWT는 사람 검토용). `OracleDraftSchema`(`{storyId, scenarios, coverage}`·oracleId 없음). `DecompositionEmittedSchema` payload에 `oracleDrafts: z.array(OracleDraftSchema).default([])` — z.infer 출력 타입에 항상 존재하므로 **기존 타입드 픽스처에 `oracleDrafts:[]` 채워 컴파일 유지**(blocker#9).
- **파이프라인·발행**: `runDecomposition(intent, deps, repairMax, draftEnabled=false)`가 `draftEnabled`면 `draftOracles` 호출 → `DecomposeResult`(ok)에 `oracleDrafts` 추가(off면 `[]`). producer `emitWorkPackages`는 **ok 경로만** `result.oracleDrafts` 전달 — inconsistent·기술 fallback 경로는 `[]`(blocker#5: degraded·그 WP는 수동 오라클 대기). flag는 `ProduceDeps.draftOracles?`(server.ts가 `config.MANAGER_ORACLE_DRAFT` 주입).
- **소비·영속(`streams/decomposition-consumer.ts`)**: `handleDecompositionEmitted`가 TaskGraph upsert 성공 후 `deps.oracleStore`가 있고 `oracleDrafts` 비어있지 않으면 각 draft를 `oracleStore.upsertDraft({workflowId, storyId, scenarios, coverage})`로 영속(oracleId는 repo가 `oracleIdFor`로 파생·단일출처). 미주입/빈 배열이면 skip(비차단·회귀 0). `buildDecompositionConsumerHandler`·`DecompositionConsumer` 생성자에 oracleStore 인자 additive.
- **`OracleRepo.upsertDraft`(신규·멱등, blocker#6)**: `oracleId=oracleIdFor(wf,storyId)`로 `INSERT ... VALUES (...,1,'pending',...) ON CONFLICT (oracle_id) DO UPDATE SET scenarios=EXCLUDED..., status='pending' WHERE oracles.status='pending'`. **version 불변**(재시도/재분해 시 pending 초안만 멱등 덮어쓰기·version 인플레 방지). approved/superseded는 WHERE로 보존(승인 오라클을 초안이 덮지 않음). 기존 `upsert`(API용·version++)는 유지.
- **`OracleRepo.approve` 수정(루프 닫기·blocker#8)**: 같은 tx에서 ①`SELECT ... FOR UPDATE` ②`status!=='pending'`(미존재·approved·superseded)이면 rollback·null(superseded 재승인 차단) ③JS에서 `drafted`→`human_approved` 일괄 전이(rejected/human_approved 불변·drafted 없으면 no-op→P3-1 회귀 0) ④`UPDATE oracles(status=approved)` ⑤`manager_events`(oracle.approved) ⑥`manager_outbox`. scenarios 파싱은 `OracleScenarioSchema.array().parse`(불량 레거시 JSON은 throw→롤백). 멱등키·아웃박스 스트림은 P3-1 그대로.
- **oracleStore 분리 배선**: `server.ts`는 `pool && (MANAGER_ORACLE_DOR || MANAGER_ORACLE_DRAFT)`이면 `OracleRepo`를 한 번 만들어 Supervisor(consumer upsert·satisfied-set)와 `oracleRoute`에 공유 → **DRAFT만 켜도 consumer upsert 동작**(blocker#1·B2 타입은 `OracleStore & DecompositionDeps['oracleStore']`). `createSupervisor`는 `SupervisorConfig.oracleDor`(=`MANAGER_ORACLE_DOR`)로 satisfied-set 주입·oracleConsumer 배선을 게이트(`shouldWireOracleConsumer` 순수 함수·D4) — DRAFT만 켜면 초안은 영속되나 DoR 게이트는 비활성. **OutboxRelay 기동 조건에 `MANAGER_ORACLE_DRAFT` 추가**(D3: DRAFT-only approve가 만든 oracle.approved 아웃박스 잔류 방지).
- **⚠️ DRAFT 영속 전제(D5)**: 초안이 **영속되려면** decomposition consumer(=Supervisor)가 돌아야 하므로 `MANAGER_ORACLE_DRAFT`는 `TASK_MANAGER_ENABLED`+`DATABASE_URL`을 실질 전제로 한다. DRAFT만 켜고 TASK_MANAGER off면 초안이 emit돼도 소비자 부재로 영속되지 않는다(config.ts 주석에 명시).
- **DB-level 통합 테스트(`test/oracle-loop.integration.test.ts`, skip-if-no-DB·blocker#10)**: `upsertDraft(drafted)` → `approve`(전이) → `approvedByWorkflow` → `oracleSatisfiedSet`이 그 WP를 satisfied로 산출 — 영속→승인→DoR 충족 루프를 실 Postgres로 실증.

## 실행 워커 (P4-1)

P1d Task Manager의 디스패치 루프(dispatch→lease→complete→re-dispatch)는 **완료 신호를 발행하는 주체가 없어** 닫히지 않았다. P4-1은 dispatch된 WP를 `owningRole` 에이전트로 **자율 호출**하고 성공 시 `wp.completion`을 발행해 기존 완료 소비자(P1d-6)가 lease release·DONE 전이·후행 재디스패치를 돌리게 함으로써 루프를 **처음으로 end-to-end로 닫는다**(Phase 4a 골격). `MANAGER_TASK_WORKER`(기본 false) flag 뒤로 가역 — off면 dispatch/reclaim이 신호를 발행하지 않고 WorkerConsumer도 미배선이라 **회귀 0**. 설계 스펙 [2026-06-09-p4-1-execution-worker-design.md](../../docs/superpowers/specs/2026-06-09-p4-1-execution-worker-design.md). **새 migration 없음**(wp.dispatch_signal·wp.completion은 Redis 트리거 신호, 기존 전이 테이블 재사용).

- **트리거 신호 계약(`streams/dispatch-signal.ts`)**: `WpDispatchSignalSchema`(envelope+`type:'wp.dispatch_signal'`+payload `{wpId, attempt}`)·`publishDispatchSignal(publish, wf, wpId, attempt, now?)`·`DISPATCH_SIGNAL_STREAM='manager:dispatched:main'`. **멱등키를 (wf,wpId,attempt)에 고정** — stepId에 wpId 포함(`wp.dispatch_signal:${wpId}`)이라 같은 wf·attempt의 여러 WP가 키 충돌하지 않음. dispatch(attempt=0)·reclaim(attempt++)이 공유(contract-drift 회피). best-effort 발행(outbox 미경유 — lease 타임아웃이 신뢰성 백스톱).
- **실행 워커 코어(`streams/worker.ts`)**: `handleWpDispatchSignal(msg, deps)` — `getGraph`로 WP 해석→`resolveAgentTool(owningRole)`→`deps.handlers[tool]` 자율 `execute(input, workflowId)`→성공 시 `wp.completion`을 `manager:completions:main`에 발행. outcome `completed`/`skipped(wp_not_found|unknown_role|no_handler)`/`failed(agent_error)`. **실패·미해석은 신호 미발행 후 return** — 새 실패 이벤트를 만들지 않고 lease 타임아웃 reclaim에 위임(결정 2/5). `buildWorkerInput(wp)`는 AC를 intent에 담고 답변자 스키마 필수 필드 합집합(intent·context·priority·projectPath·target·severity·artifacts)을 채워 어느 에이전트로 가도 safeParse 통과(Zod가 잉여 키 strip·검증 trivial은 Phase 4b 실 검증으로 대체). `shouldWireWorker(taskWorker, hasHandlers)`(순수·D4)는 둘 다 있어야 배선. `WorkerConsumer extends BaseConsumer`(group `manager-worker-consumers`·prefix `manager:dispatched`·dedup ON)는 `start('main')`로 `manager:dispatched:main` 구독.
- **dispatch/reclaim 신호 발행**: `DispatchDeps.publish?`(P4-1) 주입 시 `handleDispatch`의 recorded 분기에서 `publishDispatchSignal(publish, wf, wpId, 0)` 발행(deduped는 무발행). `SweepDeps.publish?`+`LeaseSweeperDeps.publish?` 주입 시 reclaim 분기에서 `publishDispatchSignal(publish, wf, wpId, nextAttempt)` 발행(escalate는 무발행). 미주입(flag off)이면 무발행 — 회귀 0.
- **스트림 단일출처(드리프트 0)**: 트리거 스트림 `manager:dispatched:main`(WorkerConsumer prefix+channel). 완료 스트림 `manager:completions:main`=`supervisor.ts COMPLETION_PREFIX('manager:completions')`+`DEFAULT_CHANNEL('main')`. `createSupervisor`가 worker의 `completionStream`을 `${COMPLETION_PREFIX}:${DEFAULT_CHANNEL}`로 주입해 워커 완료 발행 스트림과 기존 완료 소비자 구독 스트림을 단일 출처로 일치.
- **Supervisor·server.ts 배선**: `SupervisorConfig.taskWorker`(=`MANAGER_TASK_WORKER`)·`SupervisorDeps.handlers?`(tool명→AgentExecutor). `createSupervisor`가 `workerActive=shouldWireWorker(taskWorker, handlers!==undefined)`면 dispatch·leaseSweeper deps에 `publish` 합류 + `WorkerConsumer`를 전용 Redis 연결(makeRedis 1회 더)로 조건부 생성→start/stop 배선. `server.ts`는 `MANAGER_TASK_WORKER`면 `registry.get`으로 답변 가능 5종(`develop_code`·`design_ui`·`run_tests`·`build_project`·`security_audit` — watcher 제외) 핸들러 맵을 구성해 `handlers`로 주입(`ToolHandler.execute(input, sessionId)`가 `AgentExecutor` 구조 만족). flag off면 handlers 미주입·taskWorker=false → 미배선.
- **DB-level 통합 테스트(`test/execution-worker.integration.test.ts`, skip-if-no-DB)**: dispatch_signal→`handleWpDispatchSignal`(mock 에이전트 성공)→wp.completion capture→`handleCompletion`→DONE 전이를 실 Postgres로 실증(루프 닫힘 검증) + userContext 영속→워커 주입 라운드트립(P4a-2).

## 워크스페이스 컨텍스트 주입 (P4a-2)

P4-1의 핵심 한계(§6 Codex NEW-2 — `buildWorkerInput`이 placeholder `projectPath:'.'`라 실 에이전트가 `fs.realpath` 검증에서 거부)를 해소한다. 분해 시점의 `UserContext`를 그래프에 영속하고 워커가 에이전트 호출에 주입해 **실 에이전트 성공 완료가 성립**한다. 설계 스펙 [2026-06-10-p4a-2-workspace-context-injection-design.md](../../docs/superpowers/specs/2026-06-10-p4a-2-workspace-context-injection-design.md). **새 migration·flag 없음**(graph_dag JSONB additive·기존 flag 게이트 보존).

- **계약(additive optional)**: `decompose_request.payload.userContext`(`AbsoluteUserContextSchema` — userId·projectId·workspaceRoot·githubRepo?, **workspaceRoot 절대경로 강제** refine — 상대경로는 manager cwd mkdir→에이전트 cwd 해석으로 developer false-success를 만들므로 Zod 단계 거부) → `decomposition.emitted.payload.userContext`(위반 시 invalid_schema DLQ) → `task_graphs.graph_dag = {workPackages, userContext?}`.
- **스레딩**: sessions.route → `handleDecomposeRequest(..., userContext?, ensureWs)`(trigger try 안에서 `ensureWorkspace` — task_request 경로 대칭·실패 시에도 finally cleanup) → `produceDecomposition(..., userContext?)`(ok·기술 fallback 경로 포함, inconsistent 경로 제외) → `handleDecompositionEmitted`가 `upsertGraph`에 전달. **실패 무음 금지(M8)**: trigger catch가 모든 실패(워크스페이스 검증·발행)를 `type:'error'`로 요청자에게 발행 후 rethrow — 미발행 시 세션이 응답 없이 해체돼 무한 대기하던 결함 해소(에러 발행 실패는 원 오류 보존).
- **영속·조회(`TaskGraphRepo`)**: `PersistGraphInput.userContext?`(null/undefined면 키 생략)·`StoredGraph.userContext: UserContext | null`. `getGraph`는 **safeParse tolerant**(AbsoluteUserContextSchema) — 레거시 행은 무로그 null, 키가 있는데 실패(손상·상대경로)면 **warn 로그 후 null**(escalate 폭주 원인 추적·디스패치 경로 보호·워커는 placeholder 폴백 우아한 강등). workPackages는 기존대로 strict.
- **워커 주입(`worker.ts`)**: `AgentExecutor.execute(input, sessionId, userContext?)`(3번째 옵셔널 — `RedisAgentHandler.execute` 시그니처와 일치·2-인자 구현도 구조적 할당 가능). `buildWorkerInput(wp, userContext?)`가 `projectPath = userContext?.workspaceRoot ?? '.'` — builder/tester `validatePath`는 `fs.realpath(projectPath)`를 **에이전트 cwd 기준**으로 해석하므로 절대경로가 cwd 무관 통과(NEW-2의 실체). **intent는 4000자 클램프**(planner/designer `.max(4000)` 정합 — 초과 시 DLQ→타임아웃 방지·AC 전체는 plan에 무손실 보존). `handleWpDispatchSignal`이 `stored.userContext`를 입력·execute 양쪽에 전달 → RedisAgentHandler가 `payload.userContext`로 spread → 에이전트 `resolveWorkspaceRoot(payload.userContext, config.workspaceRoot)` 소비.
- **한계(후속)**: 재분해가 userContext 없이 오면 graph_dag 교체로 유실(가변 프로젝션 의미·트리거 UX가 항상 채우는 것으로 해소 예정). 모노레포 서브프로젝트 라우팅은 범위 밖. ~~검증 trivial~~ → **P4b-1 검증 게이트로 해소**(아래).

## 검증 게이트 (P4b-1)

P4-1 워커의 trivial 완료 판정(무예외=성공)을 **실행 ground truth 기반 fail-closed 검증**으로 교체한다(senario N1 — "테스트 통과"는 실제 실행 결과로만 성립). tester가 `success:false`를 반환해도 무예외면 DONE이 되던 false-pass 구멍을 봉합한다. `MANAGER_WP_VERIFY`(기본 false) flag 뒤로 가역 — off면 워커 동작 P4a-2와 바이트 단위 동일·회귀 0. 설계 스펙 [2026-06-10-p4b-1-verification-gate-design.md](../../docs/superpowers/specs/2026-06-10-p4b-1-verification-gate-design.md). **새 migration·테이블 없음**(이벤트는 Redis 스트림·재시도는 기존 lease 기계 재사용).

- **`streams/verify.ts` 순수 코어**: `judgePrimaryResult(tool, result)` — **결과-근거 판정**(run_tests `success && failed===0 && passed>0`·build_project `success`; 판정 전용 minimal Zod·**기본값 없음** — 필드 부재=파싱 실패=fail. `passed`도 required — **P4b-3 vacuous-pass 봉합**: RedisAgentHandler outputSchema가 `passed`를 0으로 default해도 `passed<=0`이면 fail-closed(0-test가 `failed:0`으로 통과하던 빈 껍데기 스위트 차단·N8 선행). `planVerificationChecks(tool)` — **파생 체크 플랜**(develop_code → `['build_project','run_tests']` fail-fast 순서; run_tests/build_project WP는 자기 결과가 이미 ground truth라 이중 실행 회피·design_ui/security_audit는 실행 가능 ground truth 부재(4d) → 빈 플랜). `verifyWp(tool, wp, result, deps)` — ①→② 오케스트레이션, **never-throw**(핸들러 부재·throw·파싱 실패·**workspaceRoot 미영속** 전부 fail verdict — 불확실=실패. '.' 폴백 검증은 에이전트 cwd⊂WORKSPACE_ROOT 배포에서 에이전트 자신을 검증하는 false PASS라 실행 전 차단). `verifySessionId(wf,wpId,attempt)` — 파생 체크 전용 **격리 세션 키**(RedisAgentHandler 응답 매칭이 무상관(스트림 위치+type)이라 워크플로 공유 세션은 타임아웃 좀비 응답이 다음 attempt 판정으로 오귀속(N1 false-pass) — 사설 응답 스트림으로 구조 차단).
- **파생 체크 실행**: 워커 `handlers` 맵(server.ts 5종)을 재사용해 `buildWorkerInput(wp, userContext)` 입력·격리 세션으로 builder/tester를 같은 워크스페이스에 실 재호출 — 판정은 LLM 선언이 아니라 실 spawn 실행 결과 필드(N1). ⚠️자동 감지 명령은 산출물(package.json scripts·Makefile)에서 파생 — 구현자가 게이트 명령을 통제하는 N6 한계(4b-2에서 명령 권위를 사람 오라클로 이전).
- **워커 통합(`worker.ts`)**: `WorkerDeps.verifyEnabled?`(기본 false)·repo에 `latestStates` 추가. verifyEnabled면 **실행 전 스테일 신호 가드**(`latestStates`가 DONE/ESCALATED → `skipped:stale_signal` — 검증이 WP당 처리 시간을 최대 3×120s=360s로 늘려 기본 가시성 300s 초과 시 false reclaim 신호가 DONE WP를 재실행·워크스페이스 재변형하는 것을 차단). execute 성공 후 verdict fail이면 **완료 미발행** + `wp.verification.failed` 관측 이벤트(`defaultInconsistentStream` 단일출처·reason 500자 클램프·**best-effort** try/catch — 부재한 completion이 load-bearing 신호·스트림 소비자 미배선이라 사람 도달 신호는 ESCALATED) 후 outcome `verification_failed`. → lease 만료 → reclaim attempt++ → 상한 초과 ESCALATED(**기존 P1d-5 백스톱이 N5 바운드 재시도·사람 에스컬레이션 담당** — 새 재시도 메커니즘 없음).
- **배선**: `SupervisorConfig.wpVerify?`(optional additive) → `buildWorkerConsumerDeps(deps, config)` **순수 헬퍼**(D4 — 스레딩 누락이 무음 fail-open 퇴행이 되지 않도록 행동 단언)로 WorkerConsumer deps 조립. server.ts가 `config.MANAGER_WP_VERIFY` 전달 + 오진 방지 경고 2종(전제 `MANAGER_TASK_WORKER` 미충족·`MANAGER_LEASE_VISIBILITY_MS<360s` 가시성 하한).
- **한계(후속)**: 빈 스위트 vacuous pass(0-test가 `failed:0` 통과)는 **P4b-3에서 `passed>0` floor로 봉합**(아래) — 단 전체 mutation-score(θ_risk) N8은 후속. 검증 실패 사유가 reclaim 재실행 입력에 미반영(비정보 재시도 — 4c informed rework). lease 가시성 경합은 **하드닝 하트비트(`LeaseStore.renewLease`)로 완화** — 워커가 실행 중 주기적(가시성/3·최대 5단계 검증 동안)으로 가시성 연장해 false reclaim 차단(`startLeaseHeartbeat`·finally stop·never-throw·0행 경고·leaseStore+visibilityMs 미주입 시 비활성 회귀 0). completion attempt CAS 미적용은 의도적(active 단방향 가드로 충분). primary 실행의 RPC 무상관은 후속. 상세는 설계 스펙 §7.

## Oracle conformance 검증 (P4b-2)

P4b-1 검증 게이트의 N6 한계(게이트 통과가 구현자의 `package.json scripts`에서 파생된 명령에만 의존 — 작성자가 검증 명령을 통제)를 봉합한다. develop_code WP 검증에 **사람 승인 오라클 GWT 시나리오를 실행 ground truth로 소비**하는 conformance 채널을 P4b-1 파생 체크 위에 additive hard-AND로 추가: 게이트가 구현자와 독립된, 사람이 승인한 동작에 묶인 검증 테스트의 실 실행 결과에 의존한다(N1·N6). `MANAGER_WP_CONFORMANCE`(기본 false) flag 뒤로 가역 — off면 P4b-1 검증과 바이트 동일·회귀 0. 전제: `MANAGER_TASK_WORKER`+`MANAGER_WP_VERIFY`+OracleRepo. 설계 스펙 [2026-06-10-p4b-2-oracle-conformance-design.md](../../docs/superpowers/specs/2026-06-10-p4b-2-oracle-conformance-design.md). **새 migration·테이블·핸들러 계약 무수정**(run_tests `testFiles?`·develop_code `artifacts[]` 기존 존재).

- **`db/oracle.repo.ts` `approvedOracleForStory(wf, storyId)`**(additive): 해당 story의 approved 오라클(최신 version)에서 `human_approved` 시나리오 + coverage 반환. 승인 행 없음·human_approved 0개면 `null`(→ conformance skip·회귀 0). `OracleScenarioSchema.array().parse`로 재검증(불량 레거시 JSON throw→상위 fail-closed). `approvedByWorkflow`(satisfied-set용)와 별개.
- **`streams/conformance.ts`(신규·순수)**: `CONFORMANCE_DIR='.xzawed/conformance'`·`buildConformanceAuthorPlan(wp, scenarios)`(승인 GWT를 번호 매겨 나열 + "실행 가능한 테스트를 `<DIR>/<wpId>.*`에 작성·**구현 파일 수정 금지**·시나리오 단언만 인코딩" 지시·4000자 클램프)·`selectConformanceTestFiles(artifacts, wpId)`(설계 §4 두 불변식: ①좌측 prefix 앵커 `<DIR>/<wpId>.`로 인접 wpId(wp-7 vs wp-70)·깊은 경로(node_modules 등) 오지정 차단 ②테스트 확장자 필터(`.test.`·`.spec.`·`_test.`·`test_`·`.py`)로 비테스트 산출물(.md·.txt·.json) 제외 — "테스트 미작성=fail-closed" 가드 유지·구분자 정규화·결정론).
- **`streams/verify.ts`**: `VerifyDeps`에 `oracleStore?`(`ConformanceOracleStore`)·`conformanceEnabled?` 추가(둘 다 optional·기본 미동작). `runConformanceCheck(wp, deps)`(**never-throw**·fail-closed): 미주입/미활성/oracle null → skip(`{ok:true}`); workspaceRoot 부재·author throw·author 테스트 미생성·run throw·run 결과 fail → fail. `execConformanceStep`이 buildInput·execute를 try 안에서 수행해 모든 throw를 fail verdict로 변환. author=독립 develop_code 호출(`conf-author` 격리 세션·plan=승인 GWT), run=Tester(`conf-run` 격리 세션·author가 만든 `testFiles`만)·`judgePrimaryResult('run_tests', ...)` 재사용. `verifyWp`는 ①②(P4b-1) 후 `tool==='develop_code'`이면 `runConformanceCheck` 호출. `verifySessionId`에 4번째 옵셔널 `suffix` 추가(P4b-1 호출 바이트 동일).
- **워커 통합(`worker.ts`)**: `WorkerDeps.oracleStore?`·`conformanceEnabled?` 추가 → verifyEnabled 경로의 `verifyWp` deps에 합류. conformance 실패도 P4b-1 그대로 완료 미발행 → lease 백스톱 reclaim→escalate(새 재시도 메커니즘 0).
- **배선(`supervisor.ts`·`server.ts`)**: `SupervisorConfig.wpConformance?`·`buildWorkerConsumerDeps`가 `conformanceEnabled = config.wpConformance && deps.oracleStore != null`(검증 우회 무음 방지·행동 단언)·oracleStore를 verify deps에 합류. server.ts는 `oracleStore` 생성 조건에 `MANAGER_WP_CONFORMANCE` 추가(`pool && (DOR||DRAFT||CONFORMANCE)`)·`wpConformance` 전달·오진 방지 경고 **3종**(conformance on인데 ①`MANAGER_WP_VERIFY` off(verifyWp 미경유 무음 no-op) ②oracleStore 부재(항상 skip) ③`MANAGER_LEASE_VISIBILITY_MS<600s`(WP당 호출 최대 5단계)).
- **한계(후속·정직 문서화)**: vacuous conformance(0-test가 `failed:0`으로 통과)는 **P4b-3 `passed>0` floor로 봉합**(아래) — 약한 스위트(테스트는 돌지만 결함 미포착)는 전체 mutation-score N8 후속. author Developer는 구현자와 같은 모델군(신규 컨텍스트·사람 승인 단언으로 *경계*만)·"구현 수정 금지"는 프롬프트 지시일 뿐(읽기전용 워크스페이스 마운트는 후속). 평문 GWT 해석(구조화 step_defs 미도입)·advisory/impact 채널·security(STRIDE)·designer 검증은 후속(4b-3/4d). **invariants/golden_refs는 P4b-3에서 스키마 추가**(migration 010·additive·default []·현재 검증 미소비 — impact 채널이 golden_refs를 differential 베이스라인으로 소비 예정·property 채널이 invariants 소비 예정).

## 검증 vacuous-pass 봉합 (P4b-3 착수)

P4b-1/P4b-2 검증 채널의 false-pass 구멍 중 가장 노출이 큰 **빈 스위트 vacuous pass**(0-test가 `failed:0`으로 통과)를 봉합한다. Tester가 이미 반환하는 실행 통과 카운트(`passed`)를 verify.ts 판정이 버리던 것을 살려, **실행·통과한 테스트가 0이면 게이트를 열지 않는다**(fail-closed·senario N8 선행). primary run_tests WP·develop_code 파생 체크·conformance 실행 세 경로를 `judgePrimaryResult` 한 곳에서 균일하게 봉합 — P4b-2가 4b-3로 미룬 "vacuous conformance"도 함께 해소. 설계 사양 [VERIFICATION_ADVERSARIAL_STRATEGY.md](../../docs/senario/VERIFICATION_ADVERSARIAL_STRATEGY.md) §3(N8)·§4(mutation score=1차 선행 지표). **새 flag·migration 없음**(기존 `MANAGER_WP_VERIFY` 게이트 안에서 동작·off면 회귀 0).

- **`streams/verify.ts` `judgePrimaryResult('run_tests')`**: 판정 전용 `TesterResultSchema`에 `passed: z.number()`를 **required**로 추가(파일의 "기본값 비의존·부재=fail" 철학 일관). 기존 `!success || failed>0` 체크 뒤에 **`passed<=0` → fail**(reason 'vacuous pass') 추가. 순서상 success/failed 위반이 먼저 발화하므로 부분 실패는 그대로 실패, "all green인데 실행 0건"만 vacuous로 차단.
- **세 경로 균일 봉합**: ①tester WP 자기 결과 ②develop_code 파생 `run_tests`(전체 스위트 — 테스트 존재 시 `passed>0`) ③conformance `conf-run`(author가 빈/비실행 테스트를 쓰면 `passed:0`→fail). 프로덕션 안전: run_tests 핸들러 `outputSchema`가 `passed`를 항상 채움(default 0)이라 실 통과 런은 `passed>0`로 통과.
- **정직한 한계**: `parseTestCounts`가 출력 포맷을 인식 못 하는 프레임워크는 `passed:0`→fail(불확실=실패의 **의도된 fail-closed**, N1/N8 — 인식 포맷 확장은 후속). **약한 스위트**(테스트는 돌지만 mutant 미포착)는 이 floor가 못 잡음 — 전체 mutation-score(θ_risk) 게이트는 P4b-3 후속 슬라이스(advisory/impact 채널과 함께).

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
MANAGER_DECOMPOSE_ENABLED=   # 선택: 기본 false. true면 decompose_request 4단계 LLM 분해 생산자 배선(P2-3a)
CLAUDE_TIMEOUT_MS=           # 선택: 단계 LLM 호출 타임아웃 ms(기본 120000). P2-3a 분해 파이프라인 등에서 사용
MANAGER_DECOMPOSE_REPAIR_MAX=   # 선택: P4 repair 루프 최대 반복(기본 2). 소진 시 decomposition.inconsistent 에스컬레이션
MANAGER_ORACLE_DOR=             # 선택: 기본 false. true+DATABASE_URL이면 디스패치 시 approved 오라클로 satisfied-set 주입 + oracle.approved 소비자 배선 + oracle API 등록(P3-1)
MANAGER_ORACLE_DRAFT=           # 선택: 기본 false. true면 decompose ok 경로가 draft 스테이지 실행 + producer가 oracleDrafts emit + consumer upsertDraft(P3-2). ⚠️초안 영속은 TASK_MANAGER_ENABLED+DATABASE_URL 전제(소비자 부재 시 미영속)
MANAGER_TASK_WORKER=            # 선택: 기본 false. true면 dispatch/reclaim이 wp.dispatch_signal 발행 + WorkerConsumer 배선 → dispatch된 WP를 owningRole 에이전트로 자율 실행 후 wp.completion 발행(P4-1). 전제: TASK_MANAGER_ENABLED+DATABASE_URL(Supervisor·getGraph)
MANAGER_WP_VERIFY=              # 선택: 기본 false. true면 워커가 완료 발행 전 실행 ground truth 검증을 fail-closed로 수행(결과-근거 판정 + develop_code 파생 빌드·테스트 재실행). 실패 시 완료 미발행 → lease 백스톱 reclaim→escalate(P4b-1). 전제: MANAGER_TASK_WORKER
MANAGER_WP_CONFORMANCE=         # 선택: 기본 false. true면 develop_code WP 검증에 사람 승인 오라클 GWT 시나리오를 실행 ground truth로 소비하는 conformance 채널 추가 — 독립 develop_code 호출이 승인 시나리오로 테스트 작성 → Tester 실행 → 결과 판정(N1/N6). 실패 시 완료 미발행 → lease 백스톱(P4b-2). 전제: MANAGER_TASK_WORKER + MANAGER_WP_VERIFY + OracleRepo(MANAGER_ORACLE_DOR||MANAGER_ORACLE_DRAFT). ⚠️ WP당 에이전트 호출 최대 5단계 → MANAGER_LEASE_VISIBILITY_MS 600s 이상 권장
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
