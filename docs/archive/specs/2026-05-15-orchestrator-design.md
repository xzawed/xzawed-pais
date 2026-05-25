# xzawedOrchestrator 설계 스펙

**날짜:** 2026-05-15  
**상태:** 승인됨  
**범위:** xzawedOrchestrator (프로젝트 지휘자) 단독 구현

---

## 1. 개요

xzawedOrchestrator(이하 지휘자)는 xzawed 멀티 에이전트 시스템의 최상위 진입점이다. 사용자가 구현하거나 관리하고 싶은 서비스를 자연어로 지시하면, 지휘자가 의도를 정제하여 xzawedManager(총관리자)에게 전달하고 그 회신을 사용자에게 중계한다.

### 현재 구현 범위

- xzawedOrchestrator만 구현
- xzawedManager 및 하위 에이전트(xzawedPlanner, xzawedDeveloper 등)는 별도 프로젝트로 추후 구현
- Manager와의 연결 인터페이스(Redis Streams 스펙)는 이번 구현에서 정의하고 stub으로 남김

---

## 2. 시스템 아키텍처

### 2.1 전체 에이전트 계층 구조

```
사용자
  ↕ Electron 앱 (IPC / WebSocket)
xzawedOrchestrator  ← 현재 구현
  ↕ Redis Streams
xzawedManager       ← 별도 서비스 (추후)
  ↕ Redis Streams
├── xzawedPlanner
├── xzawedDeveloper
├── xzawedDesigner
├── xzawedTester
├── xzawedBuilder
├── xzawedWatcher
└── xzawedSecurity
```

각 프로젝트는 독립 서비스로, 내부에 자체 Claude Orchestrator + Sub-agents를 포함한다. 서비스 간 통신은 오케스트레이터 대 오케스트레이터(Redis Streams 경유)다.

### 2.2 배포 모드 (동일 코드, 설정으로 전환)

| 모드 | 설명 | 설정 |
|------|------|------|
| **local** | 서버·Redis 모두 사용자 PC에서 실행. 단일 사용자, 다중 창 지원 | `MODE=local` |
| **remote** | 개인 클라우드 서버에 백엔드 배포. 어디서든 접속 | `MODE=remote` + `SERVER_URL` |
| **team** | 팀 공유 서버. JWT 인증 적용, 세션별 작업 격리 | `MODE=remote` + `AUTH=jwt` |

단일 사용자도 여러 Electron 창을 동시에 열어 복수의 서비스를 병렬로 생성·관리할 수 있다.

---

## 3. Monorepo 구조

```
xzawedOrchestrator/
├── packages/
│   ├── app/                  # Electron 데스크탑 앱
│   │   ├── src/main/         # Electron main process
│   │   ├── src/renderer/     # React UI (채팅·동적 패널)
│   │   └── src/preload/      # IPC bridge
│   │
│   ├── server/               # Node.js 백엔드
│   │   ├── src/api/          # REST API (Express / Fastify)
│   │   ├── src/mcp/          # MCP 서버
│   │   ├── src/claude/       # Claude 실행기 (3모드)
│   │   ├── src/streams/      # Redis Streams 클라이언트
│   │   └── src/sessions/     # 세션 관리
│   │
│   └── shared/               # 공통 TypeScript 타입·스키마
│       ├── src/types/
│       └── src/schemas/
│
├── docs/
├── .env.example
└── package.json              # pnpm workspace
```

**빌드 도구:** pnpm workspaces + Turborepo  
**언어:** TypeScript (strict mode) 전체

---

## 4. 컴포넌트 상세

### 4.1 Electron 앱 (packages/app)

메신저 형태의 데스크탑 애플리케이션.

**레이아웃:**
- 좌측 사이드바: 채널 목록(지휘자 채널, 프로젝트 현황, 알림), 진행 중 작업 목록
- 중앙: 지휘자와의 채팅 뷰 (메시지 스트리밍 지원)
- 우측: 동적 UI 패널 (서버가 JSON 스펙으로 지시하면 렌더링)
- 하단: 메시지 입력창

**동적 UI 패널:**  
서버가 메시지와 함께 `ui_spec` JSON을 반환하면 Electron이 해당 스펙에 따라 컴포넌트를 렌더링한다.

```typescript
// ui_spec 예시
{
  type: "form",
  fields: [
    { id: "service_type", type: "select", label: "서비스 유형", options: [...] },
    { id: "features", type: "checkbox_group", label: "필요 기능", options: [...] },
    { id: "notes", type: "textarea", label: "추가 요구사항" }
  ],
  submit_action: "submit_requirements"
}
```

지원 컴포넌트: `form`, `select`, `checkbox_group`, `textarea`, `mockup_viewer`, `progress_board`

**서버 연결:**  
- `MODE=local`: Electron main process가 서버를 child process로 기동 후 `localhost:{PORT}`에 IPC/WebSocket으로 연결. Redis는 로컬 Redis 인스턴스를 사용하며, 미설치 시 인메모리 폴백(ioredis-mock) 적용.
- `MODE=remote`: 설정의 `SERVER_URL`로 HTTPS + WebSocket 연결. 서버는 별도로 배포·운영.
- 연결 설정은 앱 내 Settings 화면에서 변경 가능. 변경 즉시 재연결.

### 4.2 백엔드 서버 (packages/server)

**REST API 엔드포인트:**

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/sessions` | 새 대화 세션 생성 |
| `POST` | `/sessions/:id/messages` | 메시지 전송 |
| `GET` | `/sessions/:id/messages` | 메시지 이력 조회 |
| `POST` | `/sessions/:id/ui-actions` | 동적 UI 폼 제출 |
| `GET` | `/sessions/:id/tasks` | 진행 중 작업 목록 |
| `GET` | `/health` | 서버 상태 확인 |

**WebSocket:**  
`/ws/sessions/:id` — 메시지 스트리밍·태스크 상태 실시간 푸시

**MCP 서버:**  
`/mcp` 엔드포인트로 MCP 프로토콜 노출. Claude Code 등 외부 MCP 클라이언트에서 도구로 등록 가능.

### 4.3 Claude 실행기 (packages/server/src/claude)

세 가지 실행 모드를 단일 인터페이스로 추상화한다.

```typescript
interface ClaudeRunner {
  send(messages: Message[], options: RunOptions): AsyncIterable<Chunk>
  abort(sessionId: string): Promise<void>
}

class CLIRunner implements ClaudeRunner { ... }       // claude CLI 서브프로세스
class APIRunner implements ClaudeRunner { ... }       // @anthropic-ai/sdk 직접 호출
class RemoteCLIRunner implements ClaudeRunner { ... } // SSH / HTTP 외부 서버
```

`CLAUDE_MODE` 환경변수로 전환: `cli` (기본) | `api` | `remote`

**CLI 모드 상세:**
- `child_process.spawn('claude', ['--output-format', 'stream-json', '--no-interactive'])`
- stdout을 스트림으로 수신하여 Electron에 실시간 전달
- 로컬 CLI 없을 시 자동으로 API 모드로 폴백

**원격 CLI 모드:**
- SSH 터널: `REMOTE_HOST`, `REMOTE_USER`, `REMOTE_KEY_PATH` 설정
- HTTP 래퍼: `REMOTE_CLI_URL` 설정 (원격 서버가 HTTP API로 claude CLI를 래핑한 경우)

### 4.4 Redis Streams (packages/server/src/streams)

**스트림 구조:**

| 스트림 키 | 방향 | 내용 |
|-----------|------|------|
| `orchestrator:to-manager:{sessionId}` | 지휘자 → 매니저 | 정제된 작업 지시 |
| `manager:to-orchestrator:{sessionId}` | 매니저 → 지휘자 | 작업 상태·결과·질의 |

**Consumer Group:** `orchestrator-consumers`  
ACK 기반 처리 — ACK 전 서비스 중단 시 메시지 보관, 재시작 후 자동 재개.

**세션 격리:** 세션 ID를 스트림 키에 포함하여 사용자 간·창 간 작업이 섞이지 않음.

### 4.5 세션 관리 (packages/server/src/sessions)

- 각 Electron 창 = 독립 세션
- 세션 상태: `active` | `waiting_manager` | `waiting_user` | `completed` | `error`
- 세션 메타: `sessionId`, `userId`, `createdAt`, `claudeMode`, `taskQueue`
- 로컬 모드: 인메모리 + Redis  
- 팀 모드: Redis + PostgreSQL (선택적 영속화)

---

## 5. 데이터 흐름

### 5.1 사용자 요청 처리

```
사용자 입력 (Electron)
  → WebSocket / IPC
  → API 서버 수신 (POST /sessions/:id/messages)
  → 세션 컨텍스트 로드
  → Claude 오케스트레이터 호출 (의도 파악·정제)
    ※ 필요 시 동적 UI 폼 요청 (ui_spec 반환 → 사용자 작성 → 재제출)
  → 정제된 지시를 Redis Streams에 발행
  → WebSocket으로 "전달 중" 상태 푸시
  → xzawedManager 구독·처리 (별도 서비스)
```

### 5.2 매니저 회신 처리

```
Redis Streams에서 매니저 회신 구독
  → Claude 오케스트레이터: 회신 해석·판단
    - 추가 정보 필요 → 동적 UI 폼 생성 후 사용자에게 질의
    - 방향 확인 필요 → 자연어 메시지로 사용자에게 질의
    - 완료 보고 → 결과 요약 후 사용자에게 전달
  → WebSocket 실시간 푸시 (Electron 업데이트)
```

---

## 6. 인터페이스 스펙 (xzawedManager 연동 포인트)

추후 xzawedManager 구현 시 준수할 Redis Streams 메시지 포맷.

```typescript
// 지휘자 → 매니저
interface OrchestratorToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'task_request' | 'info_response' | 'abort'
  payload: {
    intent: string           // 정제된 사용자 의도
    context: Record<string, unknown>  // 수집된 요구사항
    priority: 'normal' | 'high'
  }
}

// 매니저 → 지휘자
interface ManagerToOrchestratorMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'status_update' | 'info_request' | 'task_complete' | 'error'
  payload: {
    agentId: string          // 어느 하위 에이전트의 메시지인지
    content: string
    uiSpec?: UISpec          // 추가 입력이 필요한 경우 폼 스펙
  }
}
```

---

## 7. 환경 변수

```env
# 서버 모드
MODE=local                  # local | remote
PORT=3000
AUTH=none                   # none | jwt

# Claude 실행 모드
CLAUDE_MODE=cli             # cli | api | remote

# API 모드 (CLAUDE_MODE=api)
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6

# 원격 CLI 모드 (CLAUDE_MODE=remote)
REMOTE_CLI_URL=https://...  # HTTP 래퍼 URL
# 또는 SSH
REMOTE_HOST=my.server.com
REMOTE_USER=ubuntu
REMOTE_KEY_PATH=~/.ssh/id_rsa

# Redis
REDIS_URL=redis://localhost:6379

# 원격 서버 접속 (Electron 앱 설정)
SERVER_URL=https://my.server.com
```

---

## 8. 기술 스택 요약

| 레이어 | 기술 |
|--------|------|
| 데스크탑 앱 | Electron + React + TypeScript |
| UI 상태 관리 | Zustand |
| 백엔드 프레임워크 | Fastify (TypeScript) |
| MCP 서버 | `@modelcontextprotocol/sdk` |
| Claude SDK | `@anthropic-ai/sdk` |
| Redis 클라이언트 | `ioredis` |
| Monorepo | pnpm workspaces + Turborepo |
| 패키징 | electron-builder |
| 테스트 | Vitest (unit) + Playwright (E2E) |

---

## 9. 구현 제외 범위 (이번 스펙)

- xzawedManager 및 하위 에이전트 구현
- 사용자 인증 상세 구현 (JWT 슬롯만 확보)
- 외부 서버 원격 CLI의 서버 측 구현
- 모바일 클라이언트
