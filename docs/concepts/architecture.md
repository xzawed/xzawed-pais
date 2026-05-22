[홈](../index.md) > [개념](.) > 시스템 아키텍처

# 시스템 아키텍처

xzawedPAIS 전체 서비스 구성, xzawedOrchestrator 내부 패키지 구조, 컴포넌트 책임, 요청 흐름을 설명한다.

---

## 플랫폼 전체 구조

xzawedPAIS는 10개의 독립 서비스로 구성된다. 서비스 간 통신은 Redis Streams만 사용하며, 서비스끼리 직접 import하지 않는다.

```
사용자
  │ Electron IPC / HTTP / WebSocket
  ▼
xzawedOrchestrator (3000)
  │ 의도 정제 → orchestrator:to-manager:{sessionId}
  ▼
xzawedManager (3001)
  │ tool-calling 루프
  ├── manager:to-planner:{sessionId}    → xzawedPlanner  (3002)
  ├── manager:to-developer:{sessionId} → xzawedDeveloper (3003)
  ├── manager:to-designer:{sessionId}  → xzawedDesigner  (3004)
  ├── manager:to-tester:{sessionId}    → xzawedTester    (3005)
  ├── manager:to-builder:{sessionId}   → xzawedBuilder   (3006)
  ├── manager:to-watcher:{sessionId}   → xzawedWatcher   (3007)
  └── manager:to-security:{sessionId} → xzawedSecurity  (3008)
```

모든 에이전트 서비스는 `manager:to-{agent}:{sessionId}` 스트림을 소비하고 `{agent}:to-manager:{sessionId}` 스트림으로 응답한다.

---

## 서비스 책임

| 서비스 | 포트 | 역할 |
|---|---|---|
| xzawedOrchestrator | 3000 | 사용자 지시 수신·정제, JWT 인증, Electron UI, MCP 서버 |
| xzawedManager | 3001 | Claude tool-calling 루프, 하위 에이전트 디스패치, GitHub ops |
| xzawedShared | — | 에이전트 서비스 공통 라이브러리 (`@xzawed/agent-streams`) |
| xzawedPlanner | 3002 | intent → Step[] 분해 |
| xzawedDeveloper | 3003 | 코드 생성·수정, 파일 I/O |
| xzawedDesigner | 3004 | UI 컴포넌트 스펙 설계 |
| xzawedTester | 3005 | 테스트 실행·분석 |
| xzawedBuilder | 3006 | 프로젝트 빌드 감지·실행 |
| xzawedWatcher | 3007 | 파일 변경 감시·이벤트 스트리밍 |
| xzawedSecurity | 3008 | OWASP 보안 감사 |

---

## xzawedOrchestrator 패키지 구조

xzawedOrchestrator는 Turborepo 모노레포로 세 개의 패키지를 포함한다.

```
xzawedOrchestrator/
├── packages/
│   ├── shared/               # 공통 TypeScript 타입
│   │   └── src/types/
│   │       ├── message.ts    # Message, Chunk, MessageRole
│   │       ├── session.ts    # Session, SessionState, ClaudeMode
│   │       ├── ui-spec.ts    # UISpec, UIField, UIFieldType
│   │       └── streams.ts    # OrchestratorToManager, ManagerToOrchestrator
│   │
│   ├── server/               # Fastify 백엔드
│   │   └── src/
│   │       ├── config.ts           # 환경변수 로드·검증 (Zod)
│   │       ├── server.ts           # Fastify 인스턴스·플러그인 조립
│   │       ├── claude/             # Claude 실행기 추상화
│   │       ├── streams/            # Redis Streams Producer·Consumer
│   │       ├── sessions/           # 세션 생성·조회·상태 관리
│   │       ├── tasks/              # TaskStore (pending→running→completed/failed)
│   │       ├── auth/               # JWT, argon2id, GitHub PAT 암호화
│   │       ├── api/                # REST 라우트 (Fastify 플러그인)
│   │       ├── ws/                 # WebSocket 핸들러
│   │       └── mcp/                # MCP 서버 (stdio)
│   │
│   └── app/                  # Electron 데스크탑 앱
│       └── src/
│           ├── main/               # Electron main process, IPC 채널
│           ├── renderer/           # React 19 UI
│           └── preload/            # contextBridge IPC bridge
```

### packages/shared

공통 TypeScript 타입과 스키마만 포함한다. 런타임 로직은 없다.

| 파일 | 내용 |
|------|------|
| `types/message.ts` | `Message`, `Chunk`, `MessageRole` |
| `types/session.ts` | `Session`, `SessionState`, `ClaudeMode` |
| `types/ui-spec.ts` | `UISpec`, `UIField`, `UIFieldType`, `UISelectOption` |
| `types/streams.ts` | `OrchestratorToManagerMessage`, `ManagerToOrchestratorMessage`, `UserContext` |

### packages/server

**claude/** — Claude 실행 추상화

```
ClaudeRunner (interface)
  ├── CLIRunner         — spawn('claude', args, { shell: false })
  ├── APIRunner         — @anthropic-ai/sdk 스트리밍
  ├── HTTPRemoteRunner  — REMOTE_CLI_URL HTTP NDJSON 스트리밍
  └── SSHRemoteRunner   — SSH + exec 원격 실행
createRunner()          — CLAUDE_MODE 환경변수로 인스턴스 선택
```

**streams/** — Redis Streams 비동기 통신

```
StreamProducer  — orchestrator:to-manager:{sessionId} 발행
StreamConsumer  — manager:to-orchestrator:{sessionId} 구독 + ACK
```

**sessions/** — 세션 수명주기

```
InMemorySessionStore  — Map 기반 인메모리 저장 (MODE=local)
PgSessionStore        — PostgreSQL 영속화 (DATABASE_URL 설정 시)
createSession()       — UUID 세션 엔티티 생성
MessageRepo           — PostgreSQL 메시지 저장소
```

**tasks/** — 태스크 수명주기

```
TaskStore  — 세션별 인메모리 Map (pending→running→completed/failed)
```

**api/** — REST 엔드포인트

| 엔드포인트 | 역할 |
|-----------|------|
| `POST /sessions` | 세션 생성 |
| `POST /sessions/:id/messages` | 메시지 전송 (비동기, 202) |
| `GET /sessions/:id/messages` | 메시지 이력 조회 |
| `GET /sessions/:id/tasks` | 태스크 목록 조회 |
| `POST /sessions/:id/ui-actions` | 동적 UI 폼 제출 |
| `POST /auth/register` | 사용자 등록 |
| `POST /auth/login` | 로그인, JWT 발급 |
| `POST /auth/refresh` | access token 재발급 |
| `GET /health` | 서버 상태 확인 |

**ws/** — WebSocket 실시간 채널

`/ws/sessions/:id` — Claude 스트리밍·에이전트 상태 실시간 푸시

**mcp/** — MCP 서버 (stdio 전송)

Claude Code 등 외부 MCP 클라이언트에서 도구로 등록 가능하다.

### packages/app

| 레이어 | 역할 |
|--------|------|
| `main/` | Electron main process, IPC 채널 등록 (settings, github, mcp, plugin), GitHub OAuth 핸들러 |
| `preload/` | contextBridge IPC 노출 |
| `renderer/` | React 19 + Zustand UI (채팅·동적 패널·사이드바·CommandPalette·Settings) |

---

## 요청 흐름

### 사용자 메시지 → xzawedManager

```
[사용자 입력]
    │ Electron IPC / HTTP POST /sessions/:id/messages
    ▼
[Fastify API] ─── 202 Accepted (즉시 반환)
    │
    ▼ (비동기)
[ClaudeRunner.send()]
    │ 스트리밍 청크 → WebSocket 푸시
    ▼
[structureIntent()]   ← Anthropic SDK로 의도 1-2문장 정제
    │
    ▼
[StreamProducer.publish()]
    │ orchestrator:to-manager:{sessionId}
    ▼
[xzawedManager]
```

### xzawedManager → 사용자 화면

```
[xzawedManager 회신]
    │ manager:to-orchestrator:{sessionId}
    ▼
[StreamConsumer] (XREADGROUP + ACK)
    │
    ▼ 메시지 타입별 처리
    ├── status_update  → WebSocket agent_status 이벤트
    ├── task_complete  → WebSocket agent_done 이벤트, Consumer 종료
    ├── error          → WebSocket agent_error 이벤트, Consumer 종료
    └── info_request   → WebSocket agent_info_request 이벤트 (uiSpec 포함 가능)
    ▼
[Electron UI 업데이트]
```

---

## 배포 모드

### MODE=local

```
사용자 PC
┌────────────────────────────────────────┐
│  Electron 앱                           │
│    └─ main process                     │
│         └─ child_process.spawn(server) │
│                   │ localhost:3000     │
│              Fastify 서버             │
│                   │                   │
│              Redis (로컬)             │
│                   │                   │
│           Claude CLI (로컬)           │
└────────────────────────────────────────┘
```

Redis 미설치 시: `ioredis-mock` 인메모리 폴백 적용

### MODE=remote

```
사용자 PC                   클라우드 (Railway 등)
┌──────────────┐   HTTPS   ┌────────────────────┐
│ Electron 앱  │ ◄────────► │  Fastify 서버       │
└──────────────┘  WSS      │  Redis (원격)        │
                            │  PostgreSQL          │
                            │  Claude CLI or API  │
                            └────────────────────┘
```

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 언어 | TypeScript 5 (strict) |
| 패키지 관리 | pnpm workspaces 9.x |
| 모노레포 빌드 | Turborepo 2.x |
| 데스크탑 앱 | Electron + electron-vite |
| UI | React 19 + Zustand + Tailwind CSS v4 + shadcn/ui |
| 백엔드 | Fastify 5 + @fastify/websocket |
| MCP | @modelcontextprotocol/sdk 1.x |
| Claude SDK | @anthropic-ai/sdk |
| Redis 클라이언트 | ioredis 5.x |
| 데이터베이스 | PostgreSQL (pg) |
| 테스트 | Vitest 3 + Playwright |

---

## 관련 문서

- [세션 수명주기](sessions.md) — 세션 상태 머신 상세
- [Claude 실행 모드](claude-runners.md) — 네 가지 실행 방식
- [Redis Streams 메시징](redis-streams.md) — 비동기 통신 구조
- [동적 UI 패널](dynamic-ui.md) — 서버 주도 UI 시스템
- [REST API 레퍼런스](../reference/rest-api.md)
- [환경변수 목록](../reference/environment-variables.md)
