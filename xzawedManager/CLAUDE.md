# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedManager(총관리자)는 xzawed 멀티 에이전트 시스템의 **두 번째 계층**이다.  
xzawedOrchestrator로부터 Redis Streams로 작업 지시를 수신하고, Claude tool-calling 루프를 통해 처리한 뒤 결과를 반환한다.

현재 상태: **구현 완료 (server 320/323 테스트, 3 skip)** — 8개 ToolHandler 모두 `RedisAgentHandler` 또는 직접 Octokit 기반으로 구현. 코드로 강제하는 승인 게이트(`gates/`)·프로젝트 도메인 위키(`db/knowledge.repo.ts`·`api/knowledge.route.ts`)·AgentQuery 교차질의 라우팅 추가. JWT 인증 미들웨어 에러 코드 분기 추가. Redis 계약 통합 테스트는 `REDIS_URL` 없으면 skip. consumer.ts Redis 단절 복구(xreadgroup try/catch) + xack try/finally 보장. runner.ts request_info 누락 필드·빈 tool_use 블록 입력 검증 추가.

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
        ├── streams/            # Redis consumer + producer
        ├── claude/runner.ts    # Claude tool-calling 루프 (승인 게이트·위키 주입/저장·AgentQuery 라우팅)
        ├── gates/              # approval-gate.ts: 게이트 모드·대상·결정 파싱
        ├── db/                 # knowledge.repo.ts(KnowledgeRepo: insertMany·recentByProject 필터·updateById·deleteById) + session.repo.ts + pool.ts + migrations/
        ├── tools/              # ToolHandler 11개 (7 RedisAgent + register-project + switch-project + github-ops* + deploy-project* / *GITHUB_TOKEN 조건부) + agent-tool-map.ts + errors.ts
        ├── sessions/           # 세션 상태 추적 (session.store.ts: gateConfig·waitForInfo·게이트 override)
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
- **결정 파싱**: `parseDecision(answer)`가 `info_response.answer`(JSON)를 `GateDecision`(`approve{rememberAuto, saveToWiki, wikiSummary?}` | `revise{feedback}` | `abort`)으로 해석. 파싱 불가·미지 값은 approve로 fail-open. `wikiSummary`(PO가 저장 전 편집한 요약)는 비어있지 않은 문자열일 때만 채택(2000자 클램프).
- **요약**: `summarizeOutput(stage, result)` — content 우선, 없으면 직렬화(2000자 상한).
- **runner 게이트 훅** (`runner.ts` `applyApprovalGate`, 공통 후처리 `finalizeAgentResult` 경유): manual이면 `info_request`(`approval: { stage, summary, mode }`) 발행 후 `waitForInfo`로 대기.
  - `approve` → 결과 반환. `rememberAuto: true`면 해당 단계 override를 auto로 전환. `saveToWiki: true`면 `saveApprovedDecision`으로 승인 결정을 위키에 누적(`wikiSummary` 있으면 그 편집본을 우선 저장).
  - `revise` → 피드백을 `clarificationContext`로 추가해 재실행 후 재게이트 (`MANAGER_MAX_GATE_REVISES` 상한).
  - `abort` → 세션 abort + `GateAbortError` throw(루프 종료).
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
