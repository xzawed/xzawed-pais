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
- **다단계 분해 생산자** (`decompose/`, P2-3) — `decompose_request`를 4단계 LLM 분해(epics→slice→deliverables→roles)+repair 루프로 WP[]로 변환해 `decomposition.emitted` 발행. `MANAGER_DECOMPOSE_ENABLED` flag.
- **Oracle DoR 게이트 + 초안 생성** (`db/oracle.repo.ts` + `api/oracle.route.ts`, P3) — 사람이 승인한 오라클의 satisfied-set으로 WP 디스패치 DoR을 판정하고, 분해 시 story별 GWT 시나리오 초안을 생성해 승인 부담을 줄인다. `MANAGER_ORACLE_DOR`·`MANAGER_ORACLE_DRAFT` flag.
- **실행 워커** (`streams/worker.ts`, P4-1) — dispatch된 WP를 `owningRole` 에이전트로 자율 호출하고 성공 시 `wp.completion`을 발행해 디스패치 루프를 닫는다. `MANAGER_TASK_WORKER` flag.

> ⚠️ 위 flag들은 전부 기본 `false`(미활성)이며, `MANAGER_TASK_WORKER`·`MANAGER_ORACLE_DRAFT`는 `TASK_MANAGER_ENABLED`+`DATABASE_URL`을 실질 전제로 한다.

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
  // MANAGER_DECOMPOSE_ENABLED=true면 4단계 LLM 분해 → decomposition.emitted 발행
  payload: { intent: string }
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

---

## Architecture

```
packages/server/src/
├── index.ts                   # 진입점: Redis consumer + Fastify 서버 시작
├── config.ts                  # 환경변수 검증 (Zod superRefine + 피처 플래그 6종)
├── server.ts                  # Fastify HTTP 서버 초기화 + Supervisor/OutboxRelay/Worker flag 배선
├── api/
│   ├── health.route.ts        # GET /health
│   ├── sessions.route.ts      # 세션 관련 라우트 (decompose_request 트리거 포함)
│   ├── knowledge.route.ts     # 도메인 위키 GET/PATCH/DELETE (쓰기는 서비스 JWT)
│   └── oracle.route.ts        # 오라클 POST/PATCH approve/GET (P3-1)
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
    ├── oracle.types.ts / oracle.repo.ts # Oracle 스키마·저장소 (P3)
    └── migrations/            # 001~009
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
