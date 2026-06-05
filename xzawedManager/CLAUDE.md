# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedManager(총관리자)는 xzawed 멀티 에이전트 시스템의 **두 번째 계층**이다.  
xzawedOrchestrator로부터 Redis Streams로 작업 지시를 수신하고, Claude tool-calling 루프를 통해 처리한 뒤 결과를 반환한다.

현재 상태: **구현 완료 (server 366/371 테스트, 5 skip)** — 8개 ToolHandler 모두 `RedisAgentHandler` 또는 직접 Octokit 기반으로 구현. 코드로 강제하는 승인 게이트(`gates/`, **fail-safe 포함**)·프로젝트 도메인 위키(`db/knowledge.repo.ts`·`api/knowledge.route.ts`)·AgentQuery 교차질의 라우팅·**세션 이벤트소싱+아웃박스**(`db/event-store.ts`·`streams/outbox-relay.ts`, flag 가역) 추가. JWT 인증 미들웨어 에러 코드 분기 추가. Redis 계약 통합 테스트는 `REDIS_URL` 없으면 skip. consumer.ts Redis 단절 복구(xreadgroup try/catch) + xack try/finally 보장. runner.ts request_info 누락 필드·빈 tool_use 블록 입력 검증 추가.

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
        ├── streams/            # Redis consumer + producer + outbox-relay.ts(아웃박스→Redis 폴링 릴레이)
        ├── claude/runner.ts    # Claude tool-calling 루프 (승인 게이트·위키 주입/저장·AgentQuery 라우팅)
        ├── gates/              # approval-gate.ts: 게이트 모드·대상·결정 파싱
        ├── db/                 # knowledge.repo.ts + session.repo.ts + event-store.ts(이벤트소싱 append+replay) + pool.ts + migrations/(001~006)
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

## AgentQuery 교차질의

에이전트가 작업 중 다른 에이전트에게 질의할 수 있다. 하위 에이전트가 `AgentQueryError`(to·question·kind: `active_request` | `cross_check`)를 throw하면 runner가 처리한다.

- `resolveAgentTool(err.to)`(`tools/agent-tool-map.ts`, 에이전트명→도구명 매핑)로 대상 도구를 찾아 `{ query, queryKind }`로 실행.
- 대상 응답을 `clarificationContext`(JSON)로 넘겨 `reExecuteWithContext`로 질의한 에이전트를 재실행.
- 미지 대상·질의 실패 시 `is_error` tool_result로 폴백(루프 계속).

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
