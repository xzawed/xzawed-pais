[홈](../index.md) > [개념](.) > 시스템 아키텍처

# 시스템 아키텍처

xzawedOrchestrator의 패키지 구조, 컴포넌트 책임, 데이터 흐름을 설명합니다.

---

## 전체 시스템 구조

```
┌─────────────────────────────────────────────────────────────────┐
│  xzawedOrchestrator (이 프로젝트)                               │
│                                                                   │
│  ┌──────────────────┐        ┌──────────────────────────────┐   │
│  │  packages/app    │        │  packages/server              │   │
│  │  Electron 앱     │◄──────►│  Node.js 백엔드               │   │
│  │                  │ IPC/WS │                               │   │
│  │  - React UI      │        │  - Fastify REST API           │   │
│  │  - 채팅 채널     │        │  - WebSocket                  │   │
│  │  - 동적 UI 패널  │        │  - MCP 서버                   │   │
│  │  - Settings      │        │  - Claude 실행기              │   │
│  └──────────────────┘        │  - Redis Streams              │   │
│                               │  - 세션 관리                  │   │
│                               └──────────────┬───────────────┘   │
│                                              │                    │
│                               ┌──────────────▼───────────────┐   │
│                               │  packages/shared              │   │
│                               │  TypeScript 공통 타입         │   │
│                               └──────────────────────────────┘   │
└──────────────────────────────────────┬──────────────────────────┘
                                       │ Redis Streams
                                       ▼
                           ┌───────────────────────┐
                           │  xzawedManager        │
                           │  (별도 서비스, 구현 완료) │
                           └───────────┬───────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                   ▼
             xzawedPlanner    xzawedDeveloper     xzawedDesigner ...
             (각 프로젝트: 자체 Claude Orchestrator + Sub-agents)
```

---

## Monorepo 패키지 구조

```
xzawedOrchestrator/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
│
├── packages/
│   ├── shared/               # 공통 TypeScript 타입
│   │   └── src/types/
│   │       ├── message.ts    # Message, Chunk, MessageRole
│   │       ├── session.ts    # Session, SessionState, ClaudeMode
│   │       ├── ui-spec.ts    # UISpec, UIField, UIFieldType
│   │       └── streams.ts    # OrchestratorToManager, ManagerToOrchestrator
│   │
│   ├── server/               # 백엔드 서비스
│   │   └── src/
│   │       ├── config.ts           # 환경변수 로드·검증
│   │       ├── server.ts           # Fastify 인스턴스·플러그인 조립
│   │       ├── index.ts            # 서버 기동 진입점
│   │       ├── claude/             # Claude 실행기 (3모드 추상화)
│   │       ├── streams/            # Redis Streams Producer·Consumer
│   │       ├── sessions/           # 세션 생성·조회·상태 관리
│   │       ├── api/                # REST 라우트
│   │       ├── ws/                 # WebSocket 핸들러
│   │       └── mcp/                # MCP 서버
│   │
│   └── app/                  # Electron 데스크탑 앱
│       └── src/
│           ├── main/               # Electron main process
│           ├── renderer/           # React UI
│           └── preload/            # IPC bridge
│
└── docs/
```

---

## 컴포넌트 책임

### packages/shared

공통 TypeScript 타입·스키마만 포함합니다. **런타임 로직은 없습니다.**

| 파일 | 책임 |
|------|------|
| `types/message.ts` | 채팅 메시지, Claude 스트리밍 청크 타입 |
| `types/session.ts` | 세션 상태 머신 타입 (SessionState, ClaudeMode) |
| `types/ui-spec.ts` | 서버 → Electron 동적 UI 명세 (UISpec, UIField) |
| `types/streams.ts` | Redis Streams 메시지 포맷 (지휘자 ↔ 매니저) |

### packages/server

**claude/** — Claude 실행 추상화 레이어

```
ClaudeRunner (interface)
  ├── CLIRunner         — child_process.spawn('claude', ...)
  ├── APIRunner         — @anthropic-ai/sdk 스트리밍
  ├── HTTPRemoteRunner  — REMOTE_CLI_URL HTTP 래퍼 (NDJSON 스트리밍)
  └── SSHRemoteRunner   — SSH + exec 원격 실행
       └── createRunner() — CLAUDE_MODE 환경변수로 인스턴스 선택
```

**streams/** — Redis Streams 비동기 통신

```
StreamProducer  — orchestrator:to-manager:{sessionId} 스트림 발행
StreamConsumer  — manager:to-orchestrator:{sessionId} 구독 + ACK
redis.client    — ioredis 싱글턴
```

**sessions/** — 세션 수명주기

```
createSession()  — 세션 엔티티 생성 (UUID)
SessionStore     — 인메모리 세션 저장소 (Map)
  상태: active → waiting_manager → waiting_user → completed | error
```

**api/** — REST 엔드포인트 (Fastify 라우트 플러그인)

| 엔드포인트 | 역할 |
|-----------|------|
| `POST /sessions` | 세션 생성 |
| `POST /sessions/:id/messages` | 메시지 전송 (비동기, 202 반환) |
| `GET /sessions/:id/messages` | 메시지 이력 조회 |
| `POST /sessions/:id/ui-actions` | 동적 UI 폼 제출 |
| `GET /sessions/:id/tasks` | 진행 중 태스크 목록 |
| `GET /health` | 서버 상태 확인 |

**ws/** — WebSocket 실시간 채널

`/ws/sessions/:id` — Claude 스트리밍·태스크 상태 실시간 푸시

**mcp/** — MCP 서버 (stdio 전송)

Claude Code 등 외부 MCP 클라이언트에서 도구로 등록 가능합니다.

| 도구 | 기능 |
|------|------|
| `create_session` | 새 세션 생성 |
| `get_session_status` | 세션 상태 조회 |
| `list_sessions` | 사용자 세션 목록 |

### packages/app

| 레이어 | 역할 |
|--------|------|
| `main/` | Electron main process, 로컬 모드 시 서버 child process 기동 |
| `preload/` | contextBridge IPC 노출 |
| `renderer/` | React UI (채팅·동적 패널·사이드바·Settings) |

---

## 데이터 흐름

### 사용자 메시지 → xzawedManager

```
[사용자 입력]
    │ Electron IPC / HTTP POST /sessions/:id/messages
    ▼
[Fastify API 서버]
    │ 세션 컨텍스트 로드
    ▼
[Claude Orchestrator]
    │ 의도 파악 · 요구사항 정제
    │ 필요 시 ui_spec 생성 → WebSocket 푸시 → 사용자 양식 작성
    ▼
[StreamProducer]
    │ orchestrator:to-manager:{sessionId} 발행
    ▼
[xzawedManager] (별도 서비스)
```

### xzawedManager → 사용자 화면

```
[xzawedManager 회신]
    │ manager:to-orchestrator:{sessionId} 발행
    ▼
[StreamConsumer] (ACK 기반)
    │ 메시지 수신
    ▼
[Claude Orchestrator]
    │ 회신 해석 · 판단
    │ ├── 추가 정보 필요 → ui_spec 생성
    │ ├── 방향 확인 필요 → 자연어 질의
    │ └── 완료 → 결과 요약
    ▼
[WebSocket 푸시]
    │
    ▼
[Electron UI 업데이트]
```

---

## 배포 아키텍처

### MODE=local (기본)

```
사용자 PC
┌────────────────────────────────────────┐
│  Electron 앱                            │
│    └─ main process                      │
│         └─ child_process.spawn(server) │
│                   │ localhost:3000      │
│              Fastify 서버              │
│                   │                    │
│              Redis (로컬)              │
│                   │                    │
│           Claude CLI (로컬)            │
└────────────────────────────────────────┘
```

Redis 미설치 시: `ioredis-mock` 인메모리 폴백 적용

### MODE=remote

```
사용자 PC                   클라우드 (Railway 등)
┌──────────────┐   HTTPS   ┌──────────────────────┐
│ Electron 앱  │ ◄────────► │  Fastify 서버         │
└──────────────┘  WSS      │  Redis (원격)          │
                            │  Claude CLI or API    │
                            └──────────────────────┘
```

---

## 기술 스택

| 영역 | 기술 | 버전 |
|------|------|------|
| 언어 | TypeScript (strict) | 5.x |
| 패키지 관리 | pnpm workspaces | 9.x |
| 모노레포 빌드 | Turborepo | 2.x |
| 데스크탑 앱 | Electron | 최신 안정 |
| UI | React + Zustand | 19.x |
| 백엔드 프레임워크 | Fastify | 5.x |
| WebSocket | @fastify/websocket | — |
| MCP | @modelcontextprotocol/sdk | 1.x |
| Claude SDK | @anthropic-ai/sdk | 최신 버전 사용 |
| Redis 클라이언트 | ioredis | 5.x |
| 테스트 | Vitest + Playwright | 3.x |
| 패키징 | electron-builder | — |

---

## 다음 단계

- [세션 수명주기](sessions.md) — 세션 상태 머신 상세
- [Claude 실행 모드](claude-runners.md) — 세 가지 실행 방식
- [Redis Streams 메시징](redis-streams.md) — 비동기 통신 구조

---

## 관련 문서

- [xzawed Suite 개요](overview.md)
- [REST API 레퍼런스](../reference/rest-api.md)
- [환경변수 목록](../reference/environment-variables.md)
