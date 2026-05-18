# xzawedOrchestrator — 프로젝트 지휘자

**역할:** AI 멀티 에이전트 시스템의 최상위 진입점. 사용자 자연어 지시를 수신·정제하여 xzawedManager로 전달하고, 결과를 실시간 스트리밍으로 중계한다.

**포트:** 3000 | **상태:** 완성 (v0.1.0)

---

## 패키지 구조

```
xzawedOrchestrator/
├── packages/
│   ├── shared/     # 공통 TypeScript 타입 (Message, Session, UISpec, Streams)
│   ├── server/     # Fastify 5 백엔드 (API, WebSocket, MCP, Claude 실행기, Redis Streams)
│   └── app/        # Electron 앱 (React 19 + Zustand + electron-vite, 구현 완료)
└── CLAUDE.md
```

### packages/server 내부

```
src/
├── index.ts              # 진입점
├── config.ts             # 환경변수 검증 (zod)
├── server.ts             # Fastify 서버 초기화
├── api/                  # REST 라우트 (sessions, messages, tasks, health)
├── claude/               # ClaudeRunner 인터페이스 + 구현체
│   ├── runner.interface.ts
│   ├── cli.runner.ts     # claude CLI 서브프로세스
│   ├── api.runner.ts     # Anthropic SDK
│   └── runner.factory.ts # CLAUDE_MODE로 구현체 선택
├── streams/              # Redis StreamProducer + StreamConsumer
├── sessions/             # SessionStore, 세션 상태 머신
└── mcp/                  # MCP 서버 (stdio)
```

## Claude 실행 모드

`CLAUDE_MODE` 환경변수로 전환:

| 모드 | 방식 | 용도 |
|------|------|------|
| `cli` (기본) | 로컬 Claude Code CLI 서브프로세스 | 개인 PC, 구독 요금만 |
| `api` | Anthropic SDK 직접 호출 | API 키, 토큰당 과금 |
| `remote` | 원격 서버 CLI (SSH/HTTP) | 팀 서버 배포 |

#### Claude 스트리밍 구현
- **API 모드**: `messages.stream()` → `content_block_delta` 이벤트 → WebSocket push
- **CLI 모드**: `--output-format stream-json` NDJSON 파싱
- **HTTP 원격**: fetch ReadableStream NDJSON 스트리밍
- **SSH 원격**: SSH exec + stream-json 파싱

## Redis Streams 인터페이스

**발신:** `orchestrator:to-manager:{sessionId}`
**수신:** `manager:to-orchestrator:{sessionId}` (consumer group: `orchestrator-consumers`)

### 발신 메시지 타입
| type | 설명 |
|------|------|
| `task_request` | 사용자 지시 최초 전달 |
| `info_response` | Manager의 추가 입력 요청에 응답 |
| `abort` | 작업 중단 |

### 수신 메시지 타입
| type | 설명 |
|------|------|
| `status_update` | Manager 도구 호출 진행 상황 |
| `info_request` | 사용자 추가 입력 요청 (uiSpec 포함 가능) |
| `task_complete` | 전체 작업 완료 |
| `error` | 처리 실패 |

## HTTP API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/sessions` | 새 세션 생성 |
| `POST` | `/sessions/:id/messages` | 메시지 전송 |
| `GET` | `/sessions/:id/messages` | 메시지 이력 조회 |
| `GET` | `/sessions/:id/tasks` | 작업 목록 조회 |
| `GET` | `/health` | 헬스체크 |
| `WS` | `/ws/sessions/:id` | 실시간 스트리밍 |

## MCP 서버 도구

| 도구 | 설명 |
|------|------|
| `create_session` | 새 세션 생성 |
| `get_session_status` | 세션 상태 조회 |
| `list_sessions` | 활성 세션 목록 |

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...       # api 모드 필수
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3000
MODE=local                     # local | remote
CLAUDE_MODE=cli                # cli | api | remote
AUTH=none                      # none | jwt
MANAGER_URL=http://localhost:3001  # xzawedManager URL
SERVICE_JWT_SECRET=                # AUTH=jwt 시 필수 (32자 이상)
```

## 핵심 명령어

```bash
pnpm install
cd packages/server && pnpm dev
pnpm test
pnpm build
cd packages/server && pnpm mcp    # MCP 서버 (stdio)
```

## 관련 문서

- [아키텍처](../concepts/architecture.md)
- [Claude 실행기](../concepts/claude-runners.md)
- [Redis Streams](../concepts/redis-streams.md)
- [세션 관리](../concepts/sessions.md)
- [동적 UI](../concepts/dynamic-ui.md)
- [REST API](../reference/rest-api.md)
- [WebSocket](../reference/websocket.md)
- [MCP 도구](../reference/mcp-tools.md)
- [환경변수](../reference/environment-variables.md)
- [설계 스펙](../specs/2026-05-15-orchestrator-design.md)
