# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedOrchestrator는 xzawed 멀티 에이전트 시스템의 **프로젝트 지휘자** 역할을 하는 서비스다.
사용자 지시를 받아 의도를 정제한 뒤 xzawedManager(총관리자, 별도 서비스)로 전달하고 회신을 중계한다.

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

# 빌드
pnpm build

# MCP 서버 (stdio 모드)
cd packages/server && pnpm mcp
```

## 아키텍처

```
packages/
├── shared/     # 공통 TypeScript 타입 (Message, Session, UISpec, Streams)
├── server/     # Fastify 백엔드 (API, WebSocket, MCP, Claude 실행기, Redis Streams)
│   └── src/
│       ├── api/
│       │   └── sessions.route.ts     # POST /sessions, GET /sessions/:id/tasks 등
│       ├── claude/
│       │   ├── runner.interface.ts   # ClaudeRunner 인터페이스
│       │   ├── runner.factory.ts     # createRunner() — 모드별 Runner 선택
│       │   ├── cli-runner.ts         # 로컬 claude CLI 서브프로세스
│       │   ├── api-runner.ts         # Anthropic SDK 직접 호출
│       │   ├── http-remote-runner.ts # 원격 HTTP 서버 NDJSON 스트리밍
│       │   ├── ssh-remote-runner.ts  # SSH 연결 후 원격 claude CLI 실행
│       │   └── intent-structurer.ts  # Claude API로 사용자 의도 1-2문장 정제
│       └── tasks/
│           ├── task.ts               # Task 타입 (pending→running→completed/failed)
│           └── task.store.ts         # TaskStore — 세션별 인메모리 Map 관리
└── app/        # Electron 앱 (React 19 + Zustand + electron-vite)
    ├── src/main/
    │   ├── index.ts                  # IPC 채널 등록 (settings, github, mcp, plugin)
    │   ├── github-oauth-handler.ts   # OAuth 콜백 서버, safeStorage 토큰 암호화
    │   ├── mcp-process-manager.ts    # MCP 서버 프로세스 스폰·종료·상태
    │   └── plugin-manager.ts         # Claude Code / xzawed 플러그인 목록·설치·토글
    ├── src/preload/index.ts          # contextBridge API 노출
    └── src/renderer/src/
        ├── styles/
        │   └── globals.css            # Tailwind v4 디자인 토큰 28개
        ├── lib/
        │   ├── utils.ts               # cn() 유틸리티 (clsx + tailwind-merge)
        │   ├── markdown.ts            # Shiki 싱글턴 하이라이터
        │   └── parseAgentSteps.ts     # 에이전트 스텝 파서 유틸리티
        ├── store/
        │   ├── app.store.ts           # 앱 설정, 서버 상태
        │   ├── chat.store.ts          # 세션·메시지 상태 (logLines, tokenCount, elapsedMs, modifiedFiles 추가)
        │   └── integrations.store.ts  # GitHub·MCP·Plugin 통합 상태 (Zustand + persist)
        └── components/
            ├── ui/                    # shadcn/ui 기반 기본 컴포넌트
            │   ├── button.tsx         # CVA Button
            │   ├── scroll-area.tsx
            │   ├── badge.tsx
            │   ├── separator.tsx
            │   ├── tooltip.tsx
            │   ├── dialog.tsx
            │   └── command.tsx
            ├── layout/                # 레이아웃 컴포넌트
            │   ├── ActivityBar.tsx    # 좌측 아이콘 네비게이션 바
            │   ├── RightPanel.tsx     # 우측 컨텍스트 패널
            │   └── StatusBar.tsx      # 하단 상태 표시줄
            ├── chat/                  # 채팅 뷰 컴포넌트
            │   ├── UserBubble.tsx     # 사용자 메시지 말풍선
            │   ├── CodeBlock.tsx      # Shiki 코드 하이라이팅 블록
            │   ├── AgentTimelineCard.tsx  # 에이전트 실행 타임라인 카드
            │   ├── PipelineStrip.tsx  # 파이프라인 단계 표시 스트립
            │   └── MarkdownContent.tsx    # react-markdown + Shiki 렌더러
            ├── App.tsx                # 4패널 레이아웃 (TooltipProvider, ActivityBar, Sidebar, ChatView, RightPanel, StatusBar, CommandPalette, SettingsModal, Toaster)
            ├── Sidebar.tsx            # Slack 스타일 재설계
            ├── ChatView.tsx           # AgentTimelineCard + PipelineStrip + UserBubble 통합
            ├── MessageInput.tsx       # Framer Motion focus glow + aria-label
            ├── CommandPalette.tsx     # ⌘K Spotlight 스타일 완전 구현
            ├── SettingsModal.tsx      # shadcn Dialog 기반
            ├── DynamicPanel.tsx       # Tailwind 리스타일
            ├── GitHubPanel.tsx        # Tailwind 리스타일
            ├── McpPanel.tsx           # Tailwind 리스타일
            └── PluginPanel.tsx        # Tailwind 리스타일 + Badge 컴포넌트
```

### Electron 앱 기술 스택 (packages/app)

- **React 19 + Zustand** — UI 상태 관리
- **Tailwind CSS v4** — 디자인 토큰 28개 (`globals.css`)
- **shadcn/ui** — Button, Badge, Dialog, Command, ScrollArea, Separator, Tooltip
- **Framer Motion** — MessageInput focus glow 등 UI 애니메이션
- **Shiki** — 코드 하이라이팅 싱글턴 (`lib/markdown.ts`)
- **react-markdown** — MarkdownContent 렌더러
- **sonner** — 토스트 알림 (Toaster)
- **cmdk** — ⌘K CommandPalette (Spotlight 스타일)
- **electron-vite + @tailwindcss/vite** — 빌드 파이프라인

### 작업(Task) 생명주기

메시지 전송 시 `structureIntent()` 로 Claude API 기반 의도 정제 후 `TaskStore`에 `pending` 상태로 등록.  
Redis 이벤트 수신에 따라 상태 전이: `pending` → `status_update` → `running` → `task_complete` → `completed` / `error` → `failed`.

## Claude 실행 모드

`CLAUDE_MODE` 환경변수로 전환:
- `cli` (기본): 로컬 claude CLI 서브프로세스 (`CLIRunner`)
- `api`: Anthropic SDK 직접 호출 (`APIRunner`, ANTHROPIC_API_KEY 필요)
- `remote`: 원격 서버 CLI — `REMOTE_CLI_URL` 설정 시 `HTTPRemoteRunner`(NDJSON 스트리밍), 미설정 시 `SSHRemoteRunner`(SSH + exec)

### 원격 모드 환경 변수

```env
REMOTE_CLI_URL=http://remote-host:4000   # HTTP 원격 — 설정 시 SSH 무시
REMOTE_HOST=                             # SSH 호스트 (HTTP 미설정 시 필수)
REMOTE_USER=                             # SSH 사용자
REMOTE_KEY_PATH=~/.ssh/id_rsa            # SSH 개인키 경로
```

## 배포 모드

`MODE=local` (기본) → 내장 서버, 로컬 Redis  
`MODE=remote` → 원격 서버, HTTPS + WebSocket

## Electron 앱 주요 환경 변수

```env
# GitHub OAuth App (선택: 미설정 시 GitHub 연결 비활성화)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

GitHub 토큰은 `electron.safeStorage`로 암호화하여 `userData/github-token.enc`에 저장.  
MCP 서버 설정은 `userData/mcp-servers.json`, 플러그인 비활성 목록은 `userData/disabled-plugins.json`.

## 보안 구현 패턴

- **CLI 플래그 인젝션 방지** (`cli-runner.ts`): 사용자 메시지를 spawn args에 추가하기 전 반드시 `'--'` end-of-options 구분자 삽입
- **OAuth CSRF 방지** (`github-oauth-handler.ts`): `randomBytes(32)` state 생성 → URL에 포함 → 콜백에서 검증. state 불일치 시 400 반환
- **MCP 프로세스 보안** (`mcp-process-manager.ts`):
  - `command` allowlist: `npx|node|python|python3|deno|uvx|bunx|bun|uv`
  - `args` 위험 플래그 차단: `node -e`, `python -c`, `--eval`, URL 형태 인자
  - `env` 키 차단: `PATH`, `LD_PRELOAD`, `NODE_PATH`, `HOME` 등 민감 환경변수 덮어쓰기 금지
- **토큰 렌더러 노출 금지**: `github:get-token` IPC 채널 제거됨. GitHub 토큰은 main 프로세스에서만 접근. 렌더러에서 토큰 직접 획득 금지

## 관련 프로젝트

xzawed suite: `f:\DEVELOPMENT\SOURCE\CLAUDE\xzawedPAIS\`  
- 9개 서비스 모두 구현 완료: xzawedManager(3001), xzawedPlanner(3002), xzawedDeveloper(3003), xzawedDesigner(3004), xzawedTester(3005), xzawedBuilder(3006), xzawedWatcher(3007), xzawedSecurity(3008)
- Redis Streams 통신 포맷: `docs/specs/2026-05-15-orchestrator-design.md` 참고

## 형제 프로젝트

- **SCAManager** — Python 3.14 FastAPI backend with PostgreSQL, static analysis pipeline, Claude AI code review
- **ArcanaInsight** — TypeScript/Next.js + React, Supabase, Grok/Claude AI
