# xzawedManager

xzawedOrchestrator로부터 작업 지시를 수신하고 Claude tool-calling 루프를 통해 전문 에이전트에 위임하는 서비스.

**포트:** 3001

---

## Overview

xzawedManager는 시스템의 두 번째 계층이다. `orchestrator:to-manager:{sessionId}` 스트림에서 `task_request`를 수신하면 Claude tool-calling 루프(`MAX_ITERATIONS = 50`)를 시작한다. Claude가 도구를 선택하면 해당 ToolHandler가 대상 에이전트 스트림에 요청을 발행하고 응답을 기다린다. 각 도구 실행 전후에 `status_update`를 Orchestrator로 발행한다.

**입력:** Redis Stream `orchestrator:to-manager:{sessionId}` (`task_request`, `info_response`, `abort`, `decompose_request`)
**출력:** Redis Stream `manager:to-orchestrator:{sessionId}` (`status_update`, `info_request`, `task_complete`, `error`)

대화형 루프 외에 다음 서브시스템을 포함한다 (상세는 [xzawedManager/CLAUDE.md](../../xzawedManager/CLAUDE.md) 참고):

- **승인 게이트** (`gates/approval-gate.ts`) — 에이전트 디스패치 결과를 PO가 승인/수정/중단하는 코드 강제 게이트. fail-safe(파싱 불가·미지 응답은 자동 승인 금지·`needs_human` 에스컬레이션) 기본 활성.
- **도메인 위키** (`db/knowledge.repo.ts` + `api/knowledge.route.ts`) — 프로젝트 단위 도메인 지식 누적·주입·조회 API.
- **세션 이벤트소싱 + 트랜잭셔널 아웃박스** (`db/event-store.ts` + `streams/outbox-relay.ts`, P0) — append-only `manager_events` 진실원천과 replay 복원. `EVENT_SOURCED_SESSION` flag로 가역.
- **Task Manager** (`streams/supervisor.ts` 외, P1d) — `decomposition.emitted` 소비→Task Graph 영속→ready WP 디스패치→lease 가시성 타임아웃/reclaim/escalate→완료 시 후행 unblock 재디스패치. `TASK_MANAGER_ENABLED` flag.
- **다단계 분해 생산자** (`decompose/`, P2-3·P6) — `decompose_request`를 다단계 LLM 분해(epics→slice→deliverables→roles→**P6 infer-edges**)+repair 루프로 WP DAG로 변환해 `decomposition.emitted` 발행. infer-edges가 story-level 선행 의존을 비순환 정제해 WP 간선을 파생(FLAT 제거)하고 `epicRef`→`epicId`를 전파(§7). `MANAGER_DECOMPOSE_ENABLED` flag.
- **Oracle DoR 게이트 + 초안 생성** (`db/oracle.repo.ts` + `api/oracle.route.ts`, P3) — 사람이 승인한 오라클의 satisfied-set으로 WP 디스패치 DoR을 판정하고, 분해 시 story별 GWT 시나리오 초안을 생성해 승인 부담을 줄인다. `MANAGER_ORACLE_DOR`·`MANAGER_ORACLE_DRAFT` flag.
- **실행 워커** (`streams/worker.ts`, P4-1) — dispatch된 WP를 `owningRole` 에이전트로 자율 호출하고 성공 시 `wp.completion`을 발행해 디스패치 루프를 닫는다. `MANAGER_TASK_WORKER` flag.
- **검증 게이트** (`streams/verify.ts`, P4b-1) — 워커가 완료 발행 전 실행 ground truth 검증을 fail-closed로 수행(tester/builder 결과-근거 판정 + develop_code WP는 빌드·테스트 실 재실행). 실패 시 완료 미발행 → lease 백스톱이 reclaim→escalate. `MANAGER_WP_VERIFY` flag.
- **Oracle conformance 검증** (`streams/verify.ts` + `streams/conformance.ts`, P4b-2) — develop_code WP 검증에 사람 승인 오라클 GWT 시나리오를 실행 ground truth로 소비한다. 독립 develop_code 호출이 승인 시나리오로 conformance 테스트를 작성(격리 세션·구현 수정 금지)하고 Tester가 실행해 그 결과로 게이트 — 구현자가 게이트 명령을 통제하는 P4b-1 N6 한계를 봉합(N1·N6). 승인 오라클 부재면 skip(회귀 0). `MANAGER_WP_CONFORMANCE` flag.
- **검증 vacuous-pass 봉합** (`streams/verify.ts`, P4b-3) — `judgePrimaryResult('run_tests')`에 `passed>0` floor를 추가해 0-test가 `failed:0`으로 통과하던 빈 스위트·빈 conformance를 fail-closed로 차단(primary·파생·conformance 균일·N8 선행). 함께 `db/oracle.types.ts`에 invariants(§4)·golden_refs(§5) 스키마(migration 010·additive·default `[]`·현재 검증 미소비 — impact/property 채널 선결)를 추가했다. `MANAGER_WP_VERIFY` 게이트 안.
- **impact 채널 (N8) — golden differential** (`streams/verify.ts` + `db/oracle.repo.ts`, P4·#294) — 검증 3채널(§9)의 셋째 렌즈 impact 첫 슬라이스. develop_code WP 산출물이 **사람 사인오프 golden 기준 출력에서 벗어났는지**(drift) 실행으로 검증해 drift면 **blocking**. 미소비로 남던 oracle `golden_refs`(migration 010)를 처음 소비하고 **N7(골든 자동 갱신 금지·읽기만)** 가드를 활성화. P4b-2 author→run 골격을 제네릭 `runAuthoredCheck<T>`로 추출해 conformance·impact가 공유(CPD 0)·`executeAuthoredTest` 추출로 S3776 ≤15. 독립 develop_code(`impact-author` 격리)가 `.xzawed/impact/`에 differential 테스트 작성→Tester(`impact-run`) 실행→결과 게이트. `verifyWp`가 conformance→impact 순서 hard-AND. `MANAGER_WP_IMPACT` flag(전제 `MANAGER_TASK_WORKER`+`MANAGER_WP_VERIFY`+OracleRepo)·off면 회귀 0. 잔여: affected-story 회귀+결합도-냄새→advisory 라우팅·mutation θ_risk.
- **property 채널 — invariants (conformance 렌즈)** (`streams/verify.ts` + `streams/conformance.ts` + `db/oracle.repo.ts`, P4) — 미소비로 남던 oracle `invariants`(migration 010 §4)를 처음 소비해 **사람 승인 불변식을 boundary+명시 속성 단언 테스트**로 검증한다 — 위반이면 **blocking**. `runAuthoredCheck<T>` 공유(CPD 0)·`verifyWp` 데이터 주도 채널 루프 hard-AND(conformance→impact→property)로 S3776↓. 독립 develop_code(`prop-author` 격리)가 `.xzawed/property/`에 테스트 작성→Tester(`prop-run`) 실행→결과 게이트. **N7 invariants 읽기만**. `approvedInvariantsForStory` 추가. `MANAGER_WP_PROPERTY` flag(전제 `MANAGER_TASK_WORKER`+`MANAGER_WP_VERIFY`+OracleRepo)·off면 회귀 0. 잔여: fuzz(fast-check)·metamorphic·invariant draft 생성기·mutation θ_risk.
- **mutation θ_risk 게이트 (N8 강화)** (`streams/verify.ts` + `streams/conformance.ts`, P4) — correctness 게이트의 둘째 이빨(spec §9 `correctness = all(blocking) AND mscore≥θ(risk)`). develop_code WP 스위트가 **주입 결함(mutant)을 실제로 잡는지** 검증한다 — 미만이면 **blocking**. oracle 미소비(자가단언 하니스). `runMutationCheck`가 `executeAuthoredTest` 재사용(CPD 0)·채널 루프 hard-AND 마지막 append(`[conformance, impact, property, mutation]`). 독립 develop_code(`mut-author`)가 `.xzawed/mutation/`에 자가단언 하니스를 작성(mutant K회 실행→killed/total 집계→score<θ면 fail)→Tester(`mut-run`) 실행→`judgePrimaryResult`가 게이트. `meetsMinRisk`로 HIGH 이상 WP에만 실행(비용 bound·기본 dormant). `MANAGER_WP_MUTATION` flag(전제 `MANAGER_TASK_WORKER`+`MANAGER_WP_VERIFY`·oracle 미불필요)·off면 회귀 0. 잔여: per-tier θ(P2r 캘리브레이션)·실 mutation 도구·하니스 메타검증·mutation_results 영속.
- **advisory 채널 (N3)** (`streams/advisory.ts` + `db/advisory.repo.ts` + migration 013, P4·#292) — 검증 3채널(§9) 중 optimization 렌즈 **비차단 큐**. correctness(차단) 게이트와 분리해 "더 나은 점" 제안을 영속한다 — **advisory는 절대 게이트를 막지 않는다(N3)**. `verify.ts`(차단 게이트)는 advisory를 전혀 모르고, 워커가 `verdict.ok` 후 develop_code WP에 한해 `produceAdvisory`(best-effort never-throw·`runStage` 재사용 LLM 1회→순위 findings·MAX 8 절단·fail-soft)를 호출 → `AdvisoryRepo.recordFindings` 단일 tx 아웃박스(`wp.advisory.found` + manager_outbox + advisory_findings 투영·M5/M7·멱등 `(wf,wpId,attempt,rank)` M6). `MANAGER_WP_ADVISORY` flag. 잔여: impact 라우팅·깊은 적대 생성·조회 API/UI·mutation θ_risk.
- **§13 횡단 회복탄력성** (`claude/runner.ts` + `tools/` + shared `budget/`·`resilience/`) — 병렬-비용/장애/동시성 폭발 선제 보호. (a) **budget 서킷**: 러너 tool-loop이 호출 전 누적 USD 비용 `check`(워크플로/일 상한 초과 시 fail-closed throw→error 발행)·호출 후 `record`, `MANAGER_BUDGET_PER_WORKFLOW_USD`·`MANAGER_BUDGET_DAILY_USD`(0=비활성). (b) **provider 서킷**: provider(Anthropic) 지속 장애(429/5xx/529·연결/타임아웃)를 추적, 연속 실패 임계 도달 시 회로 open→cooldown 동안 fail-fast, `MANAGER_PROVIDER_CIRCUIT` flag. (c) **벌크헤드**: 7개 `RedisAgentHandler`에 공유 주입해 에이전트 종류별 동시 RPC를 캡·초과 시 큐잉(백프레셔·드롭 없음), `MANAGER_BULKHEAD_GLOBAL`·`MANAGER_BULKHEAD_PER_AGENT`(0=무제한). 트립은 강등 모드(P6) 신호 입력.
- **DLQ 재처리 운영 라우트** (`api/admin.route.ts`) — `POST /api/admin/dlq/redrive`가 shared `redriveDlq`로 격리된 poison 메시지를 멱등 마커 선삭제 후 원 스트림에 재발행한다(reason 필터·count 배치 상한). **인증 필수**(authHook 없으면 server.ts가 미등록 — open admin endpoint 금지).
- **무음 drop 봉합(M8)** (`api/sessions.route.ts`) — 미처리 `msg.type`·decompose 비활성 시 무음 auto-ack drop(요청자 무한 대기·consumer 누수)을 명시 `error` 발행 + 세션 정리로 봉합.
- **M9 의사결정 영속** (`db/decision.repo.ts` + migration 011, P6·#288) — 사람 결정(결함 브리프·강등 사인오프·게이트 override·오라클 승인·SAFE 재개)을 **event-sourced·append-only 불변·비부인**으로 영속한다. `DecisionRequest`(상태머신 `PENDING→RESOLVED|EXPIRED|SUPERSEDED`)·`HumanDecision`·`SignOff`를 단일 tx 아웃박스(M5/M7/M9)로 적재, 전 쓰기 멱등(M6), `EXPIRED`는 비-무음 에스컬레이션(M8). 소비자·API·UI는 후속 P6 슬라이스 — **미배선·additive**.
- **P2r-2 리스크 분류 영속** (`db/risk-classification.repo.ts` + migration 012) — P2r-1 결정론 코어가 산출한 `RiskClassification` 아티팩트를 영속하고 **사람 승인으로 라우팅을 확정**한다(N6: `approvedForWorkflow`는 승인된 분류만 반환). 재채점=재승인(upsert version++·pending 리셋). P2r-3 생산자·P2r-4 소비는 후속 — **미배선·additive**.
- **P6 결함 의사결정 브리프** (`streams/decision-brief.ts` + `streams/lease.ts`) — lease 상한 초과로 ESCALATED되는 WP를 `defect_brief` `DecisionRequest`로 영속해 사람 도달 핸드오프로 폐합한다(§15·M8). `handleLeaseSweep`의 `onEscalated`(best-effort)가 `buildDefectBrief`(§4 choice 옵션)→`DecisionRepo.createRequest`를 호출. **M9 DecisionRepo의 첫 런타임 소비**. `MANAGER_DECISION_BRIEF` flag(전제 `TASK_MANAGER_ENABLED`+`DATABASE_URL`). 사람 결정 라우팅·UI는 후속.

> ⚠️ 위 flag들은 전부 기본 `false`(미활성)이며, `MANAGER_TASK_WORKER`·`MANAGER_ORACLE_DRAFT`는 `TASK_MANAGER_ENABLED`+`DATABASE_URL`을, `MANAGER_WP_VERIFY`는 `MANAGER_TASK_WORKER`를, `MANAGER_WP_CONFORMANCE`·`MANAGER_WP_IMPACT`·`MANAGER_WP_PROPERTY`는 `MANAGER_WP_VERIFY`+OracleRepo(`MANAGER_ORACLE_DOR`||`MANAGER_ORACLE_DRAFT`)를, `MANAGER_WP_MUTATION`은 `MANAGER_WP_VERIFY`(OracleRepo 불필요)를, `MANAGER_WP_ADVISORY`는 `MANAGER_WP_VERIFY`+`DATABASE_URL`을 실질 전제로 한다.

---

## API / Redis Streams 인터페이스

### Redis 수신

스트림: `orchestrator:to-manager:{sessionId}`
Consumer Group: `manager-consumers`

```typescript
type OrchestratorToManagerMessage =
  | TaskRequestMessage
  | InfoResponseMessage
  | AbortMessage
  | DecomposeRequestMessage

interface TaskRequestMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'task_request'
  payload: {
    intent: string
    context: Record<string, unknown>
    priority: 'normal' | 'high'
    userContext?: UserContext
    gateMode?: 'manual' | 'auto'   // 전역 승인 게이트 기본 모드 (#215)
  }
}

interface InfoResponseMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'info_response'
  // answer가 승인 게이트 응답이면 JSON 결정으로 해석:
  // { decision: 'approve'|'revise'|'abort', rememberAuto?, saveToWiki?, wikiSummary?, feedback? }
  payload: { answer: string }
}

interface AbortMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'abort'
  payload: Record<string, never>
}

interface DecomposeRequestMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'decompose_request'
  // MANAGER_DECOMPOSE_ENABLED=true면 4단계 LLM 분해 → decomposition.emitted 발행.
  // userContext(P4a-2)는 그래프에 영속돼 실행 워커가 에이전트 호출에 주입(워크스페이스 컨텍스트).
  payload: { intent: string; userContext?: UserContext }
}

interface UserContext {
  userId: string
  projectId: string
  workspaceRoot: string
  githubRepo?: { owner: string; repo: string; branch: string }
}
```

### Redis 발신

스트림: `manager:to-orchestrator:{sessionId}`

```typescript
interface ManagerToOrchestratorMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'status_update' | 'info_request' | 'task_complete' | 'error'
  payload: {
    agentId: string
    content: string
    uiSpec?: UISpec
  }
}
```

| `type` | 발행 시점 |
|--------|-----------|
| `status_update` | 도구 호출 시작 / 완료 시 |
| `info_request` | Claude가 `request_info` 도구 호출 시 (사용자 추가 입력 필요) |
| `task_complete` | tool-calling 루프 `end_turn` 종료 시 |
| `error` | 예외 발생 또는 최대 반복 초과 시 |

### ToolHandler 인터페이스

```typescript
interface ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> {
  name: string
  description: string
  inputSchema: Anthropic.Tool['input_schema']  // JSON Schema — Anthropic API에 직접 전달
  execute(input: TInput, sessionId: string, userContext?: UserContext): Promise<TOutput>
}
```

### 11개 ToolHandler

| 도구 이름 | 위임 대상 | 발행 스트림 |
|-----------|-----------|-------------|
| `plan_task` | xzawedPlanner | `manager:to-planner:{sessionId}` |
| `develop_code` | xzawedDeveloper | `manager:to-developer:{sessionId}` |
| `design_ui` | xzawedDesigner | `manager:to-designer:{sessionId}` |
| `run_tests` | xzawedTester | `manager:to-tester:{sessionId}` |
| `build_project` | xzawedBuilder | `manager:to-builder:{sessionId}` |
| `watch_changes` | xzawedWatcher | `manager:to-watcher:{sessionId}` |
| `security_audit` | xzawedSecurity | `manager:to-security:{sessionId}` |
| `github_ops`* | GitHub API (Octokit 직접 호출) | — |
| `deploy_project`* | GitHub 저장소에 프로젝트 파일 배포 | — |
| `register_project` | 프로젝트 레지스트리 등록 (PR #114) | — |
| `switch_project` | 활성 프로젝트 전환 (PR #114) | — |

`github_ops`·`deploy_project`(*)는 `GITHUB_TOKEN` 환경변수가 설정된 경우에만 ToolRegistry에 등록된다. `github_ops` 지원 action: `createRepo`, `createBranch`, `commitAndPush`, `createPR`, `createIssue`, `mergeBranch`, `listRepos`, `listBranches`. `deploy_project`는 승인 게이트에서 **항상 manual**(auto override 무시).

내장 도구 `request_info`는 Claude가 사용자 추가 입력이 필요할 때 직접 호출하며, Orchestrator로 `info_request`를 발행하고 `sessionStore.waitForInfo()`로 응답을 대기한다. 승인 게이트도 같은 채널을 사용한다(`info_request.payload.approval`).

### HTTP API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스체크 |
| `GET` | `/projects/:projectId/knowledge` | 도메인 위키 조회 (limit·q·source·category 필터, 비인증·읽기) |
| `PATCH` | `/projects/:projectId/knowledge/:id` | 위키 항목 수정 (`SERVICE_JWT_SECRET` 설정 시 서비스 JWT 필요) |
| `DELETE` | `/projects/:projectId/knowledge/:id` | 위키 항목 삭제 (〃) |
| `POST` | `/workflows/:workflowId/oracles` | 오라클 생성/업서트 (P3-1, `MANAGER_ORACLE_DOR` 시 등록) |
| `PATCH` | `/oracles/:oracleId/approve` | 오라클 승인 — drafted→human_approved 일괄 전이로 DoR 충족 (`approvedBy` 필수) |
| `GET` | `/workflows/:workflowId/oracles` | 워크플로 오라클 목록 (status 필터) |
| `POST` | `/api/admin/dlq/redrive` | DLQ 격리 메시지 재처리 (reason·count 필터, **인증 필수** — authHook 미설정 시 미등록) |

---

## Architecture

```
packages/server/src/
├── index.ts                   # 진입점: Redis consumer + Fastify 서버 시작
├── config.ts                  # 환경변수 검증 (Zod superRefine + 피처 플래그 + §13 회복탄력성 env)
├── server.ts                  # Fastify HTTP 서버 초기화 + Supervisor/OutboxRelay/Worker/§13 서킷·벌크헤드 flag 배선
├── api/
│   ├── health.route.ts        # GET /health
│   ├── sessions.route.ts      # 세션 관련 라우트 (decompose_request 트리거·무음 drop 봉합 M8)
│   ├── knowledge.route.ts     # 도메인 위키 GET/PATCH/DELETE (쓰기는 서비스 JWT)
│   ├── oracle.route.ts        # 오라클 POST/PATCH approve/GET (P3-1)
│   └── admin.route.ts         # POST /api/admin/dlq/redrive (DLQ 재처리·인증 필수)
├── auth/
│   └── jwt.plugin.ts          # @fastify/jwt 기반 서비스 간 JWT 인증
├── claude/
│   └── runner.ts              # ClaudeRunner — tool-calling 루프 (승인 게이트·위키 주입/저장·AgentQuery 라우팅)
├── gates/
│   └── approval-gate.ts       # 게이트 모드·대상·결정 파싱 (fail-safe)
├── decompose/                 # P2-3 다단계 분해 생산자 (pipeline·producer·trigger·stages/)
├── streams/
│   ├── consumer.ts            # orchestrator:to-manager 스트림 구독
│   ├── producer.ts            # manager:to-orchestrator 스트림 발행
│   ├── outbox-relay.ts        # 트랜잭셔널 아웃박스 → Redis 폴링 릴레이 (P0)
│   ├── supervisor.ts          # Task Manager 생명주기 코디네이터 (P1d-7)
│   ├── decomposition-consumer.ts # decomposition.emitted → Task Graph 영속 (P1d-2)
│   ├── dispatch.ts            # ready WP 디스패치 + Oracle satisfied-set DoR (P1d-4·P3-1)
│   ├── lease.ts / lease-sweeper.ts # lease 만료 sweep·reclaim·escalate (P1d-5)
│   ├── completion.ts          # 완료 → lease release·DONE·후행 재디스패치 (P1d-6)
│   ├── oracle-consumer.ts     # oracle.approved → 재디스패치 (P3-1)
│   ├── dispatch-signal.ts     # wp.dispatch_signal 트리거 계약 (P4-1)
│   ├── worker.ts              # 실행 워커 — WP를 owningRole 에이전트로 자율 실행 (P4-1)
│   ├── verify.ts              # 검증 게이트 — correctness + conformance + impact + property 채널 (P4b-1·P4b-2·P4 N8·P4 property)
│   ├── conformance.ts         # conformance/impact/property 순수 헬퍼 — author plan·테스트 파일 선별·InvariantOracleStore (P4b-2·P4 N8·P4 property)
│   ├── advisory.ts            # advisory 채널 — produceAdvisory 비차단 생산·AdvisoryStore 포트 (P4 N3)
│   └── redis.client.ts        # ioredis 클라이언트 (공유 + 전용 연결)
├── sessions/
│   └── session.store.ts       # SessionStore — gateConfig·waitForInfo·EventStore 컴포지션
├── tools/                     # ToolHandler 11개 + agent-tool-map.ts (AgentQuery 라우팅)
├── types/
│   ├── streams.ts             # OrchestratorToManagerMessage, ManagerToOrchestratorMessage
│   └── user-context.ts        # UserContext 타입
├── workspace.ts               # 워크스페이스 경로 유틸리티
└── db/
    ├── pool.ts                # PostgreSQL 연결 풀
    ├── session.repo.ts        # DB 기반 세션 저장
    ├── event-store.ts         # 세션 이벤트소싱 append+replay (P0)
    ├── knowledge.repo.ts      # 도메인 위키 저장소
    ├── task-graph.repo.ts     # Task Graph 영속 (P1d-3)
    ├── dispatch.repo.ts       # 디스패치 원자 적재 + lease 획득 (P1d-4/5a)
    ├── lease.repo.ts          # LeaseStore — reclaim·escalate·완료 (P1d-5b/6)
    ├── oracle.types.ts / oracle.repo.ts # Oracle 스키마·저장소 (P3·P4b-3 invariants/golden_refs)
    ├── decision.types.ts / decision.repo.ts # M9 의사결정 영속 — DecisionRequest/HumanDecision/SignOff (P6·#288)
    ├── oracle.repo.ts          # ... + approvedGoldensForStory (P4 impact 베이스라인·읽기만 N7·#294) + approvedInvariantsForStory (P4 property 베이스라인·읽기만 N7)
    ├── advisory.types.ts / advisory.repo.ts # advisory 채널 영속 — recordFindings 단일 tx·findingsByWorkflow (P4 N3·#292)
    ├── risk-classification.types.ts / risk-classification.repo.ts # P2r-2 리스크 분류 영속 — RiskClassification 프로젝션·사람 승인
    └── migrations/            # 001~013 (010 oracle invariants/golden·011 decisions·012 risk_classifications·013 advisory_findings)
```

---

## Configuration

| 환경변수 | 필수 | 기본값 | 설명 |
|---------|------|--------|------|
| `ANTHROPIC_API_KEY` | 예 | — | Anthropic API 키 |
| `CLAUDE_MODEL` | 아니오 | `claude-sonnet-4-6` | 사용할 Claude 모델 |
| `REDIS_URL` | 아니오 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 아니오 | `3001` | HTTP 서버 포트 |
| `MODE` | 아니오 | `local` | `local` \| `remote` |
| `SERVICE_JWT_SECRET` | 아니오 | — | JWT 인증 키 — 설정 시 인증 활성화 (32자 이상 필수) |
| `DATABASE_URL` | 아니오 | — | PostgreSQL 연결 문자열 (이벤트소싱·Task Manager·Oracle의 전제) |
| `GITHUB_TOKEN` | 아니오 | — | GitHub PAT — 설정 시 `github_ops`·`deploy_project` 핸들러 활성화 |

### 승인 게이트

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `MANAGER_GATE_FAILSAFE` | `true` | `false`면 레거시 fail-open(파싱 불가 시 자동 승인) 복원 |
| `MANAGER_MAX_GATE_REASKS` | `3` | `needs_human` 재요청 최대 횟수 — 초과 시 세션 중단 |
| `MANAGER_MAX_GATE_REVISES` | — | revise 재실행 상한 — fail-safe면 소진 시 에스컬레이션 |
| `MANAGER_WIKI_INJECT_LIMIT` | — | 도구 호출 전 주입할 최근 위키 지식 건수 |

### 피처 플래그 (자율 워크플로 — 전부 기본 `false`)

| 환경변수 | 설명 | Phase |
|---------|------|-------|
| `EVENT_SOURCED_SESSION` | Postgres 이벤트소싱 진실원천 + replay 복원 (`DATABASE_URL` 필요) | P0 |
| `TASK_MANAGER_ENABLED` | Task Manager Supervisor 배선 — 분해 소비·디스패치·lease sweep·완료 흐름 (`DATABASE_URL` 필요) | P1d-7 |
| `MANAGER_DECOMPOSE_ENABLED` | `decompose_request` → 4단계 LLM 분해 생산자 | P2-3a |
| `MANAGER_ORACLE_DOR` | approved 오라클 satisfied-set DoR 게이트 + oracle.approved 소비자 + oracle API | P3-1 |
| `MANAGER_ORACLE_DRAFT` | 분해 시 story별 GWT 시나리오 초안 생성·영속 (⚠️영속은 `TASK_MANAGER_ENABLED`+`DATABASE_URL` 전제) | P3-2 |
| `MANAGER_TASK_WORKER` | 실행 워커 — dispatch된 WP를 owningRole 에이전트로 자율 실행 후 `wp.completion` 발행 (전제 동일) | P4-1 |
| `MANAGER_WP_VERIFY` | 워커 검증 게이트 — 완료 발행 전 fail-closed 실 검증(결과-근거 판정 + develop_code 파생 빌드·테스트 재실행), 실패 시 완료 미발행 → lease 백스톱 (전제: `MANAGER_TASK_WORKER`) | P4b-1 |
| `MANAGER_WP_CONFORMANCE` | Oracle conformance 채널 — develop_code WP 검증 시 사람 승인 GWT를 독립 develop_code 호출이 실행 테스트로 작성→Tester 실행→결과 게이트(N1·N6). 승인 오라클 부재면 skip (전제: `MANAGER_WP_VERIFY`+OracleRepo, 가시성 600s↑ 권장) | P4b-2 |
| `MANAGER_DECISION_BRIEF` | 결함 의사결정 브리프 — lease 상한 초과 escalation을 `defect_brief` DecisionRequest로 영속(사람 도달 핸드오프·M8/M9). 전제: `TASK_MANAGER_ENABLED`+`DATABASE_URL` | P6 |
| `MANAGER_WP_IMPACT` | impact 채널(N8) golden-differential — develop_code WP 검증 시 사람 사인오프 golden_refs를 실행 ground truth로 소비(독립 develop_code가 differential 테스트 작성→Tester 실행→drift면 blocking). golden 읽기만(N7). 전제: `MANAGER_WP_VERIFY`+OracleRepo, 가시성 상향 권장 | P4 |
| `MANAGER_WP_PROPERTY` | property 채널(invariants·conformance 렌즈) — develop_code WP 검증 시 사람 승인 invariants를 boundary+명시 속성 단언 테스트로 소비(독립 develop_code가 작성→Tester 실행→위반이면 blocking). invariants 읽기만(N7). 전제: `MANAGER_WP_VERIFY`+OracleRepo, conformance+impact+property 동시 가시성 상향 권장 | P4 |
| `MANAGER_WP_MUTATION` | mutation θ_risk 게이트(N8 강화) — HIGH-risk develop_code WP 검증 시 자가단언 하니스로 mutation_score≥θ를 요구(미만이면 blocking). oracle 미소비. 전제: `MANAGER_WP_VERIFY`(`MANAGER_TASK_WORKER` 포함), 가시성 상향 권장 | P4 |
| `MANAGER_MUTATION_THETA` | mutation 통과 floor(killed/total ≥ θ). 기본 0.6. 잠정 캘리브레이션값 | P4 |
| `MANAGER_MUTATION_MIN_RISK` | 이 risk 등급 이상 WP만 mutation 실행(비용 bound). 기본 HIGH. 불량값은 HIGH 폴백 | P4 |
| `MANAGER_MUTATION_MAX_MUTANTS` | 하니스가 생성할 최대 mutant 수(비용 캡). 기본 10 | P4 |
| `MANAGER_WP_ADVISORY` | advisory 채널(N3) — develop_code WP의 verdict.ok 후 비차단 optimization 제안을 `advisory_findings` 투영 + `wp.advisory.found`로 영속(절대 게이트 미차단·best-effort never-throw). 전제: `MANAGER_WP_VERIFY`+`DATABASE_URL` | P4 |

### §13 횡단 회복탄력성 (병렬-비용/장애/동시성 보호)

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `MANAGER_BUDGET_PER_WORKFLOW_USD` | `0`(비활성) | budget 서킷 — 워크플로(세션)당 USD 비용 상한. >0이면 러너가 호출 전 누적 비용 검사(초과 시 fail-closed)·호출 후 누적 |
| `MANAGER_BUDGET_DAILY_USD` | `0`(비활성) | budget 서킷 — 일(UTC) 전체 USD 비용 상한. 인메모리(재시작 시 일 카운터 소실) |
| `MANAGER_PROVIDER_CIRCUIT` | `false` | provider 서킷 — provider 지속 장애(429/5xx/529·연결/타임아웃) 추적, 연속 실패 임계 시 open→cooldown fail-fast |
| `MANAGER_PROVIDER_CIRCUIT_THRESHOLD` | `5` | provider 서킷 연속 실패 임계 — 도달 시 회로 open |
| `MANAGER_PROVIDER_CIRCUIT_COOLDOWN_MS` | `30000` | provider 서킷 open 유지 ms — 경과 후 half_open 1회 probe |
| `MANAGER_BULKHEAD_GLOBAL` | `0`(무제한) | 벌크헤드 — 전역 동시 에이전트 RPC 캡 |
| `MANAGER_BULKHEAD_PER_AGENT` | `0`(무제한) | 벌크헤드 — 에이전트 종류별 동시 RPC 캡. 캡 도달 시 큐잉(백프레셔·드롭 없음) |

### Task Manager 튜닝

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `MANAGER_OUTBOX_POLL_MS` | `500` | 아웃박스 릴레이 폴링 주기 ms |
| `MANAGER_LEASE_SWEEP_MS` | `30000` | lease 만료 sweep 주기 ms |
| `MANAGER_LEASE_VISIBILITY_MS` | `300000` | lease 가시성 타임아웃 ms |
| `MANAGER_LEASE_MAX_ATTEMPTS` | `3` | 최대 디스패치 시도 — 초과 시 escalate |
| `MANAGER_DECOMPOSE_REPAIR_MAX` | `2` | 분해 P4 repair 루프 최대 반복 — 소진 시 `decomposition.inconsistent` |
| `CLAUDE_TIMEOUT_MS` | `120000` | 단계 LLM 호출 타임아웃 ms |

---

## Development

사전 조건: xzawedShared 빌드 불필요 (Turborepo 기반).

```bash
pnpm install

# 서버 개발 모드
cd packages/server && pnpm dev

# 전체 테스트
pnpm test

# 단일 테스트 파일
cd packages/server && pnpm test src/tools/plan-task.test.ts

# 빌드
pnpm build
```

---

## Related

- [xzawedOrchestrator](orchestrator.md)
- [xzawedPlanner](planner.md)
- [xzawedDeveloper](developer.md)
- [xzawedDesigner](designer.md)
- [Redis Streams](../concepts/redis-streams.md)
- [환경변수 레퍼런스](../reference/environment-variables.md)
- [설계 스펙](../archive/specs/2026-05-15-manager-design.md)
