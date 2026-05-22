# xzawedManager

xzawedOrchestrator로부터 작업 지시를 수신하고 Claude tool-calling 루프를 통해 전문 에이전트에 위임하는 서비스.

**포트:** 3001

---

## Overview

xzawedManager는 시스템의 두 번째 계층이다. `orchestrator:to-manager:{sessionId}` 스트림에서 `task_request`를 수신하면 Claude tool-calling 루프(`MAX_ITERATIONS = 50`)를 시작한다. Claude가 도구를 선택하면 해당 ToolHandler가 대상 에이전트 스트림에 요청을 발행하고 응답을 기다린다. 각 도구 실행 전후에 `status_update`를 Orchestrator로 발행한다.

**입력:** Redis Stream `orchestrator:to-manager:{sessionId}` (`task_request`, `info_response`, `abort`)
**출력:** Redis Stream `manager:to-orchestrator:{sessionId}` (`status_update`, `info_request`, `task_complete`, `error`)

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
  }
}

interface InfoResponseMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'info_response'
  payload: { answer: string }
}

interface AbortMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'abort'
  payload: Record<string, never>
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

### 8개 ToolHandler

| 도구 이름 | 위임 대상 | 발행 스트림 |
|-----------|-----------|-------------|
| `plan_task` | xzawedPlanner | `manager:to-planner:{sessionId}` |
| `develop_code` | xzawedDeveloper | `manager:to-developer:{sessionId}` |
| `design_ui` | xzawedDesigner | `manager:to-designer:{sessionId}` |
| `run_tests` | xzawedTester | `manager:to-tester:{sessionId}` |
| `build_project` | xzawedBuilder | `manager:to-builder:{sessionId}` |
| `watch_changes` | xzawedWatcher | `manager:to-watcher:{sessionId}` |
| `security_audit` | xzawedSecurity | `manager:to-security:{sessionId}` |
| `github_ops` | GitHub API (Octokit 직접 호출) | — |

`github_ops`는 `GITHUB_TOKEN` 환경변수가 설정된 경우에만 ToolRegistry에 등록된다. 지원 action: `createRepo`, `createBranch`, `commitAndPush`, `createPR`, `createIssue`, `mergeBranch`, `listRepos`, `listBranches`.

내장 도구 `request_info`는 Claude가 사용자 추가 입력이 필요할 때 직접 호출하며, Orchestrator로 `info_request`를 발행하고 `sessionStore.waitForInfo()`로 응답을 대기한다.

### HTTP API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스체크 |

---

## Architecture

```
packages/server/src/
├── index.ts                   # 진입점: Redis consumer + Fastify 서버 시작
├── config.ts                  # 환경변수 검증 (Zod superRefine으로 SERVICE_JWT_SECRET 길이 검증)
├── server.ts                  # Fastify HTTP 서버 초기화
├── api/
│   ├── health.route.ts        # GET /health
│   └── sessions.route.ts      # 세션 관련 라우트
├── auth/
│   └── jwt.plugin.ts          # @fastify/jwt 기반 서비스 간 JWT 인증
├── claude/
│   └── runner.ts              # ClaudeRunner — tool-calling 루프 (MAX_ITERATIONS=50)
├── streams/
│   ├── consumer.ts            # orchestrator:to-manager 스트림 구독
│   ├── producer.ts            # manager:to-orchestrator 스트림 발행
│   └── redis.client.ts        # ioredis 클라이언트 싱글턴
├── sessions/
│   └── session.store.ts       # SessionStore — AbortController, waitForInfo 관리
├── tools/
│   ├── handler.interface.ts   # ToolHandler<TInput, TOutput> 인터페이스
│   ├── registry.ts            # ToolRegistry — Map 기반 핸들러 등록 / 조회
│   ├── redis-agent-handler.ts # RedisAgentHandler 팩토리 — 에이전트 스트림 위임 공통 구현
│   ├── plan-task.ts           # createPlanTaskHandler
│   ├── develop-code.ts        # createDevelopCodeHandler
│   ├── design-ui.ts           # createDesignUiHandler
│   ├── run-tests.ts           # createRunTestsHandler
│   ├── build-project.ts       # createBuildProjectHandler
│   ├── watch-changes.ts       # createWatchChangesHandler
│   ├── security-audit.ts      # createSecurityAuditHandler
│   └── github-ops.ts          # createGithubOpsHandler (Octokit 직접 호출)
├── types/
│   ├── streams.ts             # OrchestratorToManagerMessage, ManagerToOrchestratorMessage
│   └── user-context.ts        # UserContext 타입
├── workspace.ts               # 워크스페이스 경로 유틸리티
└── db/
    ├── pool.ts                # PostgreSQL 연결 풀
    └── session.repo.ts        # DB 기반 세션 저장
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
| `DATABASE_URL` | 아니오 | — | PostgreSQL 연결 문자열 |
| `GITHUB_TOKEN` | 아니오 | — | GitHub PAT — 설정 시 `github_ops` 핸들러 활성화 |

---

## Development

사전 조건: xzawedShared 빌드 불필요 (Turborepo 기반).

```bash
pnpm install

# 서버 개발 모드
cd packages/server && pnpm dev

# 전체 테스트 (71건)
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
- [설계 스펙](../specs/2026-05-15-manager-design.md)
