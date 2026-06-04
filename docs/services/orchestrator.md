# xzawedOrchestrator

사용자 자연어 지시를 수신·정제하여 xzawedManager로 전달하고, 결과를 WebSocket으로 실시간 중계하는 최상위 진입점 서비스.

**포트:** 3000

---

## 개요

xzawedOrchestrator는 AI 멀티 에이전트 시스템의 첫 번째 계층이다. 사용자 메시지를 수신하면 `structureIntent()`로 의도를 1-2문장으로 정제한 뒤 `orchestrator:to-manager:{sessionId}` 스트림에 발행한다. Manager의 처리 결과는 `manager:to-orchestrator:{sessionId}` 스트림을 구독하여 수신하고, WebSocket 연결된 클라이언트에 실시간으로 전달한다.

**입력:** HTTP POST `/sessions/:id/messages` (사용자 메시지)
**출력:** Redis Stream 발행, WebSocket 이벤트 (`agent_status`, `agent_done`, `agent_error`, `agent_info_request`)

---

## API / Redis Streams 인터페이스

### Redis 발신

스트림: `orchestrator:to-manager:{sessionId}`

```typescript
// task_request: 사용자 지시 전달
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

// info_response: Manager의 추가 입력 요청에 응답
interface InfoResponseMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'info_response'
  payload: { answer: string }
}

// abort: 작업 중단
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

### Redis 수신

스트림: `manager:to-orchestrator:{sessionId}`
Consumer Group: `orchestrator-consumers`

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

interface UISpec {
  type: 'form' | 'mockup_viewer' | 'progress_board'
  title?: string
  fields?: UIField[]
  submitAction?: string
  content?: string
}

interface UIField {
  id: string
  type: 'text' | 'textarea' | 'select' | 'checkbox_group' | 'number'
  label: string
  required?: boolean
  options?: Array<{ value: string; label: string }>
  placeholder?: string
}
```

### HTTP API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/sessions` | 새 세션 생성 → `{ sessionId }` 반환 |
| `POST` | `/sessions/:id/messages` | 메시지 전송 → `202 { messageId, status: 'accepted' }` |
| `GET` | `/sessions/:id/messages` | 메시지 이력 조회 |
| `GET` | `/sessions/:id/tasks` | 작업 목록 조회 |
| `POST` | `/sessions/:id/ui-actions` | UI 폼 응답 전달 |
| `POST` | `/auth/register` | 사용자 등록 (rate limit: 5/min) |
| `POST` | `/auth/login` | 로그인 (rate limit: 5/min) |
| `POST` | `/auth/refresh` | 액세스 토큰 갱신 (rate limit: 20/min) |
| `POST` | `/auth/logout` | 로그아웃 |
| `GET` | `/auth/me` | 현재 사용자 조회 |
| `GET/POST/PUT/DELETE` | `/projects` | 프로젝트 CRUD |
| `PUT` | `/projects/:id/github-token` | GitHub PAT 저장 (AES-256-GCM) |
| `DELETE` | `/projects/:id/github-token` | GitHub PAT 삭제 |
| `GET` | `/projects/:id/github-token/status` | PAT 존재 여부 조회 (`{ exists: boolean }`) |
| `GET` | `/health` | 헬스체크 |
| `WS` | `/ws/sessions/:id` | 실시간 스트리밍 |

### WebSocket 이벤트 (서버 → 클라이언트)

| `type` | 설명 |
|--------|------|
| `chunk` | Claude 스트리밍 텍스트 조각 |
| `agent_status` | Manager 도구 호출 진행 상황 |
| `agent_done` | 전체 작업 완료 |
| `agent_error` | 처리 실패 |
| `agent_info_request` | 추가 입력 요청 (uiSpec 포함 가능) |
| `done` | 메시지 처리 완료 |
| `error` | 오류 |

### MCP 도구 (stdio)

| 도구 | 설명 |
|------|------|
| `create_session` | 새 세션 생성 |
| `get_session_status` | 세션 상태 조회 |
| `list_sessions` | 사용자의 세션 목록 조회 |

---

## 아키텍처

```
packages/
├── shared/                        # 공통 TypeScript 타입 (Message, Session, UISpec, Streams)
├── server/src/
│   ├── index.ts                   # 진입점: Fastify 서버 + Redis consumer 시작
│   ├── config.ts                  # 환경변수 검증 및 Config 타입 정의
│   ├── server.ts                  # Fastify 서버 초기화, 플러그인 등록
│   ├── api/
│   │   ├── sessions.route.ts      # 세션 / 메시지 / 작업 / UI 액션 라우트
│   │   ├── auth.route.ts          # 사용자 인증 라우트 (rate limit 포함)
│   │   ├── projects.route.ts      # 프로젝트 CRUD + GitHub PAT 관리
│   │   └── health.route.ts        # GET /health
│   ├── auth/
│   │   ├── user-auth.hook.ts      # Bearer 헤더 / WebSocket protocol 토큰 인증 훅
│   │   ├── user.repo.ts           # UserRepo (findByEmail, create, findById)
│   │   ├── refresh.repo.ts        # RefreshRepo (refresh token 관리)
│   │   ├── password.ts            # argon2id 해시 / 검증
│   │   ├── tokens.ts              # JWT access token + refresh token 발급
│   │   └── ownership.ts           # 프로젝트 소유자 검증
│   ├── claude/
│   │   ├── runner.interface.ts    # ClaudeRunner 인터페이스 (send → AsyncIterable<Chunk>)
│   │   ├── runner.factory.ts      # CLAUDE_MODE로 구현체 선택
│   │   ├── cli-runner.ts          # 로컬 claude CLI 서브프로세스
│   │   ├── api-runner.ts          # Anthropic SDK 직접 호출
│   │   ├── http-remote-runner.ts  # 원격 HTTP 서버 NDJSON 스트리밍
│   │   ├── ssh-remote-runner.ts   # SSH exec + stream-json 파싱
│   │   ├── intent-structurer.ts   # Claude API로 사용자 의도 1-2문장 정제
│   │   ├── cli-parser.ts          # NDJSON → Chunk 파싱
│   │   └── chunk-queue.ts         # 스트리밍 청크 큐
│   ├── streams/
│   │   ├── consumer.ts            # manager:to-orchestrator 스트림 구독
│   │   ├── producer.ts            # orchestrator:to-manager 스트림 발행
│   │   ├── session-gateway.ts     # SessionGateway consumer (Phase 1)
│   │   ├── project-gateway.ts     # ProjectGateway consumer (Phase 1)
│   │   └── redis.client.ts        # ioredis 클라이언트 싱글턴
│   ├── sessions/
│   │   ├── session.ts             # Session 타입 정의
│   │   ├── session.store.ts       # InMemorySessionStore (인터페이스)
│   │   ├── pg-session.store.ts    # PostgreSQL 기반 세션 저장소
│   │   └── message.repo.ts        # MessageRepo (DB 기반 메시지 저장)
│   ├── tasks/
│   │   ├── task.ts                # Task 타입 (pending→running→completed/failed)
│   │   └── task.store.ts          # TaskStore — 세션별 인메모리 Map
│   ├── db/
│   │   └── pool.ts                # PostgreSQL 연결 풀
│   ├── github-tokens/
│   │   ├── github-token.crypto.ts # AES-256-GCM PAT 암호화 / 복호화
│   │   └── github-token.repo.ts   # DB 기반 PAT 저장소
│   ├── ws/
│   │   └── session.ws.ts          # WebSocket 핸들러
│   └── mcp/
│       ├── server.ts              # MCP 서버 도구 등록
│       └── entry.ts               # stdio 진입점 (pnpm mcp)
└── app/                           # Electron 앱 (React 19 + Zustand + electron-vite)
```

### Claude 실행 모드

`CLAUDE_MODE` 환경변수로 구현체 선택:

| 모드 | 구현체 | 설명 |
|------|--------|------|
| `api` (기본) | `APIRunner` | Anthropic SDK 직접 호출 — `ANTHROPIC_API_KEY` 필요 |
| `cli` | `CLIRunner` | 로컬 claude CLI 서브프로세스 |
| `remote` | `HTTPRemoteRunner` / `SSHRemoteRunner` | `REMOTE_CLI_URL` 설정 시 HTTP, 미설정 시 SSH |

---

## 환경 변수

| 환경변수 | 필수 | 기본값 | 설명 |
|---------|------|--------|------|
| `ANTHROPIC_API_KEY` | `CLAUDE_MODE=api` 시 필수 | — | Anthropic API 키 |
| `CLAUDE_MODEL` | 아니오 | `claude-sonnet-4-6` | 사용할 Claude 모델 |
| `REDIS_URL` | 아니오 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 아니오 | `3000` | HTTP 서버 포트 |
| `MODE` | 아니오 | `local` | `local` \| `remote` |
| `CLAUDE_MODE` | 아니오 | `api` | `api` \| `cli` \| `remote` |
| `AUTH` | 아니오 | `none` | `none` \| `jwt` |
| `SERVICE_JWT_SECRET` | `AUTH=jwt` 시 필수 | — | 서비스 간 JWT 서명 키 (32자 이상) |
| `USER_JWT_SECRET` | 사용자 인증 시 필수 | — | 사용자 JWT access token 서명 키 |
| `MANAGER_URL` | 아니오 | `http://localhost:3001` | xzawedManager HTTP URL |
| `DATABASE_URL` | 아니오 | — | PostgreSQL 연결 문자열 |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | 아니오 | — | GitHub PAT 암호화 키 (32바이트 hex, 64자) |
| `SERVE_WEB` | 아니오 | `false` | `true`로 설정 시 정적 웹 파일 서빙 |
| `REMOTE_CLI_URL` | `CLAUDE_MODE=remote` + HTTP 시 | — | 원격 HTTP 서버 URL |
| `REMOTE_HOST` | `CLAUDE_MODE=remote` + SSH 시 | — | SSH 호스트 |
| `REMOTE_USER` | 아니오 | — | SSH 사용자 |
| `REMOTE_KEY_PATH` | 아니오 | `~/.ssh/id_rsa` | SSH 개인키 경로 |

---

## 개발

사전 조건: xzawedShared 빌드 불필요 (Turborepo 기반).

```bash
pnpm install

# 서버 개발 모드
cd packages/server && pnpm dev

# 전체 테스트 (unit + browser + server)
pnpm test

# 서버 테스트만
cd packages/server && pnpm test

# MCP 서버 (stdio 모드)
cd packages/server && pnpm mcp

# 빌드
pnpm build
```

---

## 관련 프로젝트

- [아키텍처 개요](../concepts/architecture.md)
- [Claude 실행기](../concepts/claude-runners.md)
- [Redis Streams](../concepts/redis-streams.md)
- [세션 관리](../concepts/sessions.md)
- [REST API 레퍼런스](../reference/rest-api.md)
- [WebSocket 레퍼런스](../reference/websocket.md)
- [MCP 도구 레퍼런스](../reference/mcp-tools.md)
- [환경변수 레퍼런스](../reference/environment-variables.md)
- [xzawedManager](manager.md)
