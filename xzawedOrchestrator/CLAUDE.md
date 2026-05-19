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

# 전체 테스트 (Vitest: unit + browser 모드)
pnpm test

# 특정 패키지 테스트
cd packages/server && pnpm test

# Playwright E2E 테스트 (Electron 앱 실행 필요 — 별도 빌드 선행)
cd packages/app && pnpm build && pnpm test:e2e

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
│       │   ├── sessions.route.ts     # POST /sessions, GET /sessions/:id/tasks 등
│       │   ├── auth.route.ts         # POST /auth/register|login|refresh|logout, GET /auth/me (IP Rate Limiting)
│       │   └── projects.route.ts     # CRUD + PUT|DELETE /projects/:id/github-token, GET /projects/:id/github-token/status
│       ├── auth/
│       │   ├── user-auth.hook.ts     # Bearer 헤더 + Sec-WebSocket-Protocol bearer.<token> 인증
│       │   ├── user.repo.ts          # UserRepo (findByEmail, create, findById)
│       │   ├── refresh.repo.ts       # RefreshRepo (refresh token 관리)
│       │   ├── password.ts           # argon2id 해시/검증
│       │   ├── tokens.ts             # JWT access token + refresh token 발급
│       │   └── github-token.crypto.ts # AES-256-GCM GitHub PAT 암호화
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
    ├── e2e/                          # Playwright E2E 테스트 (13건)
    │   ├── fixtures.ts               # Electron 자동 실행 fixture (playwright._electron)
    │   ├── chat-flow.spec.ts         # 채팅 흐름 4건
    │   ├── github-status.spec.ts     # GitHub 패널 3건
    │   ├── mcp-list.spec.ts          # MCP 패널 3건
    │   └── settings.spec.ts          # 설정 모달 3건
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
- **Shiki** — 코드 하이라이팅 싱글턴 (`lib/markdown.ts`); `codeToHast()` + `hast-util-to-jsx-runtime`으로 `dangerouslySetInnerHTML` 없이 렌더
- **react-markdown** — MarkdownContent 렌더러
- **hast-util-to-jsx-runtime** — Shiki HAST → React 노드 변환 (XSS 방지 핵심)
- **sonner** — 토스트 알림 (Toaster)
- **cmdk** — ⌘K CommandPalette (Spotlight 스타일)
- **electron-vite + @tailwindcss/vite** — 빌드 파이프라인
- **electron-builder** — Electron 앱 패키징 (package 스크립트)

### TypeScript / tsconfig 규칙

- **moduleResolution**: `tsconfig.node.json`·`e2e/tsconfig.json`은 `"Node16"` 사용 — `"Node"` (node10)은 TS6에서 deprecated
- **baseUrl 금지**: `moduleResolution: Bundler` 환경에서 `baseUrl`은 TS6 deprecated — path alias 필요 시 `paths` 단독 사용
- **renderer tsconfig outDir 불필요**: vite/electron-vite는 tsconfig `outDir`을 무시하고 자체 output config 사용 — `tsconfig.json`(renderer)에서 `outDir` 제거, `rootDir` 명시

### 테스트 인프라

- **Vitest 3** + `vitest.config.ts` `projects` API — `unit` (node) + `browser` (playwright/chromium) 두 프로젝트 분리
  - `unit`: `test/**/*.test.ts` — 17건 (store, main 프로세스 유닛 테스트)
  - `browser`: `src/renderer/src/__tests__/**/*.browser.test.tsx` — 14건 (컴포넌트 렌더링)
  - 총 `pnpm test`: **41건** (app) + **111건** (server, 10건은 Redis/DB 없으면 skip) + **6건** (ui, jsdom) = **158건**
- **@vitest/browser + playwright** — 실제 Chromium에서 React 컴포넌트 렌더링 검증
- **@testing-library/react** — 브라우저 모드 렌더링; `afterEach(cleanup)` 명시 필요
- **@playwright/test** + `playwright._electron` — Electron E2E (`e2e/`, 13건, `pnpm test:e2e`)
  - `e2e/fixtures.ts`: Electron 앱 자동 실행·종료 fixture
  - data-testid/aria-label: ActivityBar·Sidebar·GitHubPanel·McpPanel·MessageInput·CodeBlock·PipelineStrip·ChatView에 추가
  - CI: `playwright-e2e` 잡 (`ubuntu-latest`, `xvfb-run`, Electron 바이너리 다운로드)
- **Redis 통합 테스트** (`packages/server/src/__tests__/redis-streams.integration.test.ts`) — 5건, `REDIS_URL` 없으면 skip
- **@xzawed/ui 테스트** (`packages/ui/src/__tests__/`) — 6건, jsdom 환경 (`vitest.config.ts`), `pnpm --filter @xzawed/ui test`

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
- **electronAPI 타입 선언** (`src/renderer/src/electron.d.ts`): `interface Window`와 `var electronAPI` 모두 선언 필요 — 렌더러가 `globalThis.electronAPI`로 접근할 때 `typeof globalThis`에는 Window 프로퍼티가 자동 반영되지 않으므로 global var 선언 누락 시 TS7017 오류 전체 확산
- **XSS 방지 — CodeBlock** (`components/chat/CodeBlock.tsx`): `dangerouslySetInnerHTML` 사용 금지. Shiki 출력은 `codeToHast()` + `toJsxRuntime()`으로 React 노드 변환. 폴백 코드도 JSX `{code}` 삽입(React 자동 escape)
- **SSRF 방지** (`http-remote-runner.ts`, `manager.client.ts`): `fetch` 전 `validateRemoteUrl()`/`validateManagerUrl()`로 URL scheme 검증 — `http:`/`https:` 외 차단
- **Open Redirect 방지** (`github-oauth-handler.ts`): `shell.openExternal` 전 URL이 `https://github.com/login/oauth/authorize?` 접두사인지 검증 — 불일치 시 에러
- **Redis PEL 누수 방지** (`streams/consumer.ts`): `handler(msg)` 호출을 `try/finally`로 감싸 예외 발생 시에도 `xack` 실행 보장
- **stale closure 방지** (`ChatView.tsx`): `useEffect` 내 store 액션은 `useChatStore.getState()`로 획득 — 의존성 배열 추가 없이 항상 최신 참조
- **타이머 cleanup** (`CodeBlock.tsx`): `copyTimerRef`를 `useRef`로 관리하고 언마운트 시 `clearTimeout` — 메모리 누수 방지
- **테스트 /tmp 경로 억제** (`test/main/*.test.ts`): Electron `app.getPath()` vi.fn() 목에서 `/tmp` 경로는 `// NOSONAR` 로 S5443 억제 — 실제 파일시스템 접근 없는 순수 목이므로 허용
- **void Promise 처리** (`mcp-process-manager.ts`, `sessions.route.ts`, `session.store.ts`): `void asyncFn()` 패턴은 반드시 `.catch()` 체인 필수 — S6544 방지
- **WebSocket 인증** (`auth/user-auth.hook.ts`): 브라우저 WebSocket은 커스텀 헤더 불가 → `Sec-WebSocket-Protocol: bearer.<token>` 폴백. `extractBearerToken()` 헬퍼가 Authorization 헤더 우선, 없으면 protocol 헤더에서 추출
- **Auth Rate Limiting** (`api/auth.route.ts`): `@fastify/rate-limit` 플러그인, IP당 분당 `/register`·`/login` 5회, `/refresh` 20회. `x-forwarded-for` 헤더 우선 파싱 (`getClientIp`), 초과 시 429 반환
- **GitHub PAT 관리** (`api/projects.route.ts`): `PUT|DELETE /projects/:id/github-token`, `GET /projects/:id/github-token/status`. AES-256-GCM 암호화 (`github-token.crypto.ts`). 상태 조회는 `{ exists: boolean }` 만 반환 (평문 노출 금지)
- **Refresh Token 클라이언트 자동 갱신** (`ui/stores/auth.store.ts`): `restore()` 에서 401 응답 시 refresh token으로 재발급 → `/auth/me` 재시도. `tokenStorage.ts`에 `getRefreshToken`/`setRefreshToken` 추가 (sessionStorage)
- **테스트 하드코딩 IP 억제** (`__tests__/*.test.ts`): 테스트용 더미 IP 주소(`10.0.0.x` 등)는 `// NOSONAR` 로 S1313 억제 — 실제 네트워크 접근 없는 순수 테스트 픽스처이므로 허용
- **React 19 FormEvent 미사용** (`*.tsx`): `React.FormEvent`는 React 19 `@types/react@19`에서 `@deprecated` — form submit 핸들러 타입은 `React.SyntheticEvent<HTMLFormElement>` 사용 (S1874)
- **컴포넌트 props Readonly** (`*.tsx`): 함수형 컴포넌트 props 타입은 `Readonly<{...}>` 또는 기존 인터페이스 앞에 `Readonly<Props>` 감싸기 — S6759 방지
- **globalThis vs window** (`*.tsx`, `*.ts`): 브라우저 전역 접근 시 `window.xxx` 대신 `globalThis.xxx` 사용 — S7764 방지
- **중첩 삼항 금지** (`*.tsx`): 조건이 3가지 이상이면 별도 컴포넌트 함수(`function XxxBadge`)로 추출 — S3358 방지

## 관련 프로젝트

xzawed suite: 현재 저장소 루트
- 9개 서비스 모두 구현 완료: xzawedManager(3001), xzawedPlanner(3002), xzawedDeveloper(3003), xzawedDesigner(3004), xzawedTester(3005), xzawedBuilder(3006), xzawedWatcher(3007), xzawedSecurity(3008)
- Redis Streams 통신 포맷: `docs/specs/2026-05-15-orchestrator-design.md` 참고

## 형제 프로젝트

- **SCAManager** — Python 3.14 FastAPI backend with PostgreSQL, static analysis pipeline, Claude AI code review
- **ArcanaInsight** — TypeScript/Next.js + React, Supabase, Grok/Claude AI
