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
│       │   ├── sessions.route.ts     # POST /sessions, GET /sessions/:id/tasks, POST /sessions/:id/ui-actions(승인·명확화 결정 → info_response 발행); resolveSession() 헬퍼로 중복 검증 통합 (PR #129); **C6 인텐트 라우터(#337)**: POST messages body `mode?:'chat'|'build'` — `shouldDecompose(mode,decomposeEnabled)`면 대화형 runner 스킵·`buildUserContext`(task_request·decompose 공유 DRY)·원 요청을 `publishDecomposeToManager`로 `decompose_request` 발행(자율 태스크그래프), 아니면 현행 `publishTaskToManager`(task_request) byte-identical; **전달 실패 처리(#402)**: build 경로는 전달이 유일 액션이라 `publishDecomposeToManager` 실패 시 `error` 표면화(사일런트 `done` 위장 봉합)·chat 경로는 러너가 이미 응답 스트리밍 완료라 `publishTaskToManager`가 best-effort(실패해도 `done`으로 턴 완료·Manager/Redis 미가용에도 로컬 chat 복원력); **G10 비용 write rate-limit(W14·#455)**: `registerLocalRateLimit` + per-route `withLimit(max)` — POST /sessions(10/min)·POST messages(30/min·LLM/decompose 비용 벡터)·POST ui-actions(60/min)에 `@fastify/rate-limit` 적용(IP 키잉·GET 무제한·상한+1회째 429). 스팸 비용 폭발·DoS 차단
│       │   ├── knowledge.route.ts    # GET|PATCH|DELETE /projects/:id/knowledge[/:id] — Manager 위키 프록시(상태코드 pass-through, GET 실패 시 빈 목록 폴백; GET 비인증·읽기, PATCH/DELETE는 AUTH=jwt 시 user JWT + Manager 호출에 서비스 토큰 발급·전달 #213)
│       │   ├── decisions.route.ts     # GET /projects/:id/decisions/pending(open·graceful {items:[]})|POST /projects/:id/decisions/:requestId/decision — Manager 결정 프록시(C1·#306). POST는 userAuthHook + decidedBy를 인증 사용자 JWT subject로 권위 주입(**client body 절대 미도달·M9 비부인**) + 전용 {svc:'decision-proxy'} 서비스 토큰. knowledge.route 패턴 복제
│       │   ├── auth.route.ts         # POST /auth/register|login|refresh|logout, GET /auth/me (IP Rate Limiting via registerLocalRateLimit)
│       │   ├── rate-limit.ts         # registerLocalRateLimit(app) — @fastify/rate-limit global:false 등록 + 공용 429 응답(auth·sessions 공유 단일출처·CPD0·G10 #455)
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
│       ├── i18n/
│       │   └── server-i18n.ts        # Accept-Language 파싱, LocalizedRequest 인터페이스 export (PR #129)
│       └── tasks/
│           ├── task.ts               # Task 타입 (pending→running→completed/failed)
│           └── task.store.ts         # TaskStore — 세션별 인메모리 Map 관리
└── app/        # Electron 앱 (React 19 + Zustand + electron-vite)
    ├── e2e/                          # Playwright E2E 테스트 (110건, 17 spec 파일)
    │   ├── fixtures.ts               # Electron 자동 실행 fixture — electronApp/page/loginApp/loginPage
    │   ├── helpers/
    │   │   └── mock-server.ts        # HTTP route mock 헬퍼 (auth/sessions/health)
    │   ├── pages/                    # Page Object Model (POM)
    │   │   ├── ChatPage.ts           # 채팅 뷰 POM
    │   │   ├── LoginPage.ts          # 로그인 페이지 POM
    │   │   ├── SettingsModal.ts      # 설정 모달 POM
    │   │   ├── CommandPalette.ts     # 커맨드 팔레트 POM (Control+K)
    │   │   └── panels/               # GitHubPanel/McpPanel/PluginPanel POM
    │   ├── specs/                    # 기능별 E2E 스펙 (PR #129 신규, 97건)
    │   │   ├── auth/login.spec.ts
    │   │   ├── chat/{message-flow,session-lifecycle,streaming}.spec.ts
    │   │   ├── error-states/{auth-failure,server-disconnect}.spec.ts
    │   │   ├── i18n/locale-switch.spec.ts
    │   │   ├── panels/{github-panel,mcp-panel,plugin-panel}.spec.ts
    │   │   ├── projects/project-switch.spec.ts
    │   │   ├── settings/settings.spec.ts
    │   │   └── ui/command-palette.spec.ts
    │   ├── chat-flow.spec.ts         # 채팅 흐름 (기존)
    │   ├── github-status.spec.ts     # GitHub 패널 (기존)
    │   ├── mcp-list.spec.ts          # MCP 패널 (기존)
    │   └── settings.spec.ts          # 설정 모달 (기존)
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
        │   ├── parseAgentSteps.ts     # 에이전트 스텝 파서 유틸리티
        │   ├── i18n.ts                # i18next 초기화 — init 완료 시 data-i18n-ready 속성 설정 (PR #129)
        │   ├── detect-locale.ts       # Accept-Language / localStorage 로케일 감지 (PR #129)
        │   └── api.ts                 # fetch 래퍼 (tokenStorage 연동, JSON 파싱); postUiAction(승인 결정 전송) + getKnowledge/updateKnowledge/deleteKnowledge(위키 프록시 호출)
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
            │   ├── MarkdownContent.tsx    # react-markdown + Shiki 렌더러
            │   └── UiSpecPreview.tsx  # 승인 게이트용 UISpec 읽기 전용 데모 렌더러(form 필드 행 / mockup·progress content는 MarkdownContent로 마크다운 리치 렌더 #214; 상호작용 없음)
            ├── App.tsx                # 4패널 레이아웃 (TooltipProvider, ActivityBar, Sidebar, ChatView, RightPanel, StatusBar, CommandPalette, SettingsModal, Toaster)
            ├── Sidebar.tsx            # Slack 스타일 재설계
            ├── ChatLayout.tsx         # ActivityBar 탭(activePanel) 분기 — wiki 탭에서 WikiPanel·decisions 탭에서 DecisionsPanel 렌더(#306)
            ├── ChatView.tsx           # AgentTimelineCard + PipelineStrip + UserBubble 통합; pendingInfoRequest.approval 시 승인 카드(승인/수정/중단 + rememberAuto + 지식성 단계 한정 위키저장 체크박스 + 저장 전 wikiSummary 편집 #212) 렌더 → postUiAction으로 결정 JSON 전송; handleSend는 전역 settings.gateMode + **MessageInput per-message 모드(chat\|build)**를 postMessage로 전달(build 시 C6 자율 빌드 트리거 #339, gateMode #215)
            ├── WikiPanel.tsx          # 도메인 위키 뷰어 — 검색·출처(source_agent)·분류(category) 필터, category 배지, 인라인 편집·삭제(getKnowledge/updateKnowledge/deleteKnowledge)
            ├── DecisionsPanel.tsx     # C1 결정 대기함(#306) — 프로젝트 pending 결정(결함 브리프·risk_classification 포함) 카드(location·expectedVsActual·impact·evidence·attribution faultTier/counters) + choice 버튼(decision별 `context.options` 구동·DEFAULT_CHOICES 폴백·fix_reverify만 즉시 #299 폐루프·전부 M9 영속·stale "기록만" 블랭킷 라벨 부채 해소 #318)·WikiPanel signal-abort fetch+refreshKey idiom·getPendingDecisions/submitDecision
            ├── MessageInput.tsx       # Framer Motion focus glow + aria-label + per-message Chat|Build 모드 토글(sticky·기본 chat·onSend(content,mode)·data-testid mode-toggle-* #339)
            ├── CommandPalette.tsx     # ⌘K Spotlight 스타일 완전 구현
            ├── SettingsModal.tsx      # shadcn Dialog 기반 — serverUrl·mode·userId·language + 전역 승인 게이트 모드(gateMode: manual/auto) 설정 #215
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

공통 규칙: [docs/development/conventions.md](../../docs/development/conventions.md)

**이 패키지 고유 규칙**:
- `tsconfig.node.json`·`e2e/tsconfig.json`: `"moduleResolution": "Node16"` (Node10 deprecated)
- `baseUrl` 금지: `moduleResolution: Bundler` 환경에서 deprecated — `paths` 단독 사용
- renderer `tsconfig.json`: `outDir` 제거, `rootDir` 명시 (vite가 자체 output 관리)

### 테스트 인프라

- **Vitest 3** + `vitest.config.ts` `projects` API — `unit` (node) + `browser` (playwright/chromium) 두 프로젝트 분리
  - `unit`: `test/**/*.test.ts` + `src/renderer/src/lib/parseAgentSteps.test.ts` (store, main 프로세스, 파서 유닛 테스트)
  - `browser`: `src/renderer/src/__tests__/**/*.browser.test.tsx` (App·Sidebar·ChatView(승인 카드)·WikiPanel·**DecisionsPanel**·**ChatLayout.decisions**·**decisions-api**·SettingsModal·CommandPalette·GitHubPanel·McpPanel·PluginPanel·detect-locale·app.store 등 컴포넌트·스토어 렌더링)
  - 총 `pnpm test`: **247건** (app) + **453건** (server, Redis/DB 없으면 15건 skip → 438 pass·G10 rate-limit 3건 포함) + **76건** (ui, jsdom) = **~776건**
- **@vitest/browser + playwright** — 실제 Chromium에서 React 컴포넌트 렌더링 검증
- **@testing-library/react** — 브라우저 모드 렌더링; `afterEach(cleanup)` 명시 필요
- **@playwright/test** + `playwright._electron` — Electron E2E (`e2e/`, 110건/17 spec 파일, `pnpm test:e2e`)
  - `e2e/fixtures.ts`: `electronApp`/`page` + `loginApp`/`loginPage` fixture (ELECTRON_TEST_ROUTE 환경변수 분기)
  - `e2e/pages/`: Page Object Model — ChatPage, LoginPage, SettingsModal, CommandPalette, panels/
  - `e2e/helpers/mock-server.ts`: HTTP route mock (auth/sessions/health)
  - `e2e/specs/`: 기능별 분류 — auth/chat/error-states/i18n/panels/projects/settings/ui (PR #129 신규, 97건)
  - data-testid: ActivityBar·Sidebar·GitHubPanel·McpPanel·MessageInput·CodeBlock·PipelineStrip·ChatView·streaming-indicator·command-palette-item 등
  - CI: `playwright-e2e` 잡 (`ubuntu-latest`, `xvfb-run`, Electron 바이너리 다운로드)
- **Redis 통합 테스트** (`packages/server/src/__tests__/redis-streams.integration.test.ts`) — 7건, `REDIS_URL` 없으면 skip
- **서버 i18n 테스트** (`packages/server/src/i18n/__tests__/server-i18n.test.ts`) — 18건, Accept-Language 파싱·LocalizedRequest 인터페이스 검증 (PR #129 신규)
- **@xzawed/ui 테스트** (`packages/ui/src/__tests__/`) — 76건, jsdom 환경 (`vitest.config.ts`), `pnpm --filter @xzawed/ui test`
- **knowledge 프록시 테스트** (`packages/server/src/api/__tests__/knowledge.route.test.ts`) — GET/PATCH/DELETE pass-through·폴백 검증
- **위키/승인 컴포넌트 테스트** — `WikiPanel.browser.test.tsx`(검색·출처/분류 필터·배지·편집·삭제) + ChatView 승인 카드 렌더(승인/수정/중단·rememberAuto·위키저장)

### 작업(Task) 생명주기

메시지 전송 시 `structureIntent()` 로 Claude API 기반 의도 정제 후 `TaskStore`에 `pending` 상태로 등록.  
Redis 이벤트 수신에 따라 상태 전이: `pending` → `status_update` → `running` → `task_complete` → `completed` / `error` → `failed`.

### WS 끊김 시 세션 grace 정리 (`session.ws.ts`)

WS `close` 시 세션을 **즉시 파기하지 않고** `WS_CLEANUP_GRACE_MS`(기본 15s) 후로 정리를 지연한다. grace 내 재연결(React StrictMode 재마운트·serverUrl 변경 등)이면 보류 중 teardown을 취소해 세션·`StreamConsumer`를 유지하므로 "Session not found"가 발생하지 않는다. 재연결이 없으면 grace 경과 후 컨슈머 정지 + `sessionCleanup`(store/message/task 삭제)을 수행한다. 보류 타이머는 `pendingCleanups` Map으로 관리하고 `onClose` 훅에서 일괄 정리한다(`timer.unref()`로 종료 차단 안 함). 메시지 처리 경로(`sessions.route.ts`)는 소켓을 1회 캡처하지 않고 `getSocket = () => wsSessions.get(id)` 라이브 조회로 전달 — 재연결 후 새 소켓으로 청크·done·error가 전달되도록 한다. 클라이언트(`useSessionWs`)는 **지수 백오프 자동 재연결**(`RECONNECT_BASE_MS` 500ms → `RECONNECT_MAX_MS` 10s, `attempt` 카운터, 연결 성공 시 리셋)을 구현해 순수 네트워크 단절도 복구하며, 재연결 시 최신 액세스 토큰을 재첨부한다(#231). 의도적 종료(teardown·sessionId/serverUrl 변경)는 재연결 대상에서 제외한다.

### 승인 게이트 UI

Manager가 `info_request`에 `approval{stage, summary, mode:'manual'}`를 실으면 Orchestrator는 WS로 `agent_info_request`(approval 동봉)를 전달하고, `ChatView`가 인라인 텍스트 입력 대신 **승인 카드**를 렌더한다.

- 버튼: 승인(`approve`) / 수정(`revise`, 피드백 입력 필수) / 중단(`abort`). 결정은 JSON으로 직렬화해 `postUiAction()` → `POST /sessions/:id/ui-actions` → Manager에 `info_response{answer}` 발행.
  - `approve` 시 `{decision, rememberAuto, saveToWiki, wikiSummary?}`, `revise` 시 `{decision, feedback}`, `abort` 시 `{decision}` 전송. `wikiSummary`는 PO가 위키 저장 전 요약을 편집했을 때만 포함(#212).
- `rememberAuto` 체크박스: 이후 동일 단계 자동 승인 기억.
- `saveToWiki` 체크박스: **지식성 단계**(`plan_task`·`design_ui`·`develop_code`·`security_audit`, `KNOWLEDGE_BEARING_STAGES`)에서만 노출 — Manager 가드와 동일 집합.
- `stage === 'design_ui'` + uiSpec 수신 시 `UiSpecPreview`로 디자인 산출물을 읽기 전용 미리보기(mockup·progress content는 마크다운 리치 렌더 #214).

### 도메인 위키 뷰어

ActivityBar의 **위키 탭**(`activePanel === 'wiki'`)에서 `WikiPanel`이 프로젝트 누적 지식을 표시한다. 데이터는 Orchestrator가 자체 DB 없이 Manager로 프록시(`knowledge.route.ts` GET/PATCH/DELETE)해서 조회·변경한다.

- 검색(content `q`), 출처 필터(`source_agent`: plan_task·design_ui·develop_code·security_audit), 분류 필터(`category`: decision·constraint·rule·tech).
- 항목별 category 배지 + 출처 표시, 인라인 편집(content·category)·삭제(확인 단계). 변이 성공 시 `refreshKey`로 refetch(stale clobber 방지).
- 위키 GET(읽기)은 비인증 PO 도구(프록시 GET 실패 시 빈 목록 폴백). 쓰기(PATCH/DELETE)는 `AUTH=jwt` 시 user JWT 필요 — 프록시가 Manager 호출 시 `app.jwt.sign`으로 서비스 토큰을 발급·전달(#213 defense-in-depth).

### 결정 대기함 뷰어 (C1·#306)

ActivityBar의 **결정 탭**(`activePanel === 'decisions'`)에서 `DecisionsPanel`이 프로젝트의 pending 사람 결정(`defect_brief`)을 표시하고 PO가 choice를 제출한다. **Pull 모델** — 결정은 백그라운드 lease sweep이 세션과 무관하게 비동기 생성하므로 WS push가 아니라 HTTP 프록시(`decisions.route.ts`)로 가져온다(`knowledge.route.ts` 패턴 복제).

- **조회**: `getPendingDecisions`(`lib/api.ts`) → Orchestrator GET `/projects/:id/decisions/pending`(open) → Manager `pendingByProject`. 실패 시 빈 목록 폴백. `WikiPanel`의 signal-abort fetch + `refreshKey` idiom(stale clobber 방지)·새로고침 버튼·제출 후 refetch.
- **카드(결함 브리프)**: `context.location`·`expectedVsActual`·`impact[]`·`evidenceRefs[]`·**`attribution`(faultTier·counters impl/task/plan, PR-A 4c #298)** 렌더.
- **핸들 가능 choice만 노출(D10·#333)**: defect_brief는 Manager `buildDefectBrief`가 `options:['fix_reverify']`만 실어 fix_reverify 한 개 버튼만 렌더(즉시 #299 폐루프). spec_fix/accept_known/reject는 decision-consumer에 핸들러가 없어 RESOLVED만 남기는 무음 no-op이라 **거짓 affordance 제거**. `context.options` 미제공 레거시/malformed 행만 `DEFAULT_CHOICES`(4종) 폴백. risk_classification은 approve/reject(#318)·degraded_*는 accept_known/reject.
- **결정 type 배지(#333)**: 카드 상단 `data-testid=decision-type` 배지가 `t('decisions.type_'+d.type, d.type)`로 4종 type(defect/risk/release/dispatch)을 시각 구별 — 본문 자유텍스트로만 구별되어 고위험 사인오프(accept_known on degraded vs approve on risk) 오조작하던 것 방지. d.type=백엔드 enum·React 텍스트 이스케이프(XSS 0).
- **제출·비부인(M9)**: `submitDecision`은 `{choice, justification?}`만 보낸다(`decidedBy` 미전송). 프록시 POST가 `userAuthHook` 뒤에서 `decidedBy = req.authUser?.sub ?? 'local-user'`로 **권위 주입**(client body 절대 미도달) + 전용 서비스 토큰으로 Manager 호출. 제출→toast→refetch.
- ⚠️ Task Manager flag-off라 실 결정 생성 0(데모/테스트는 seed). AUTH=none 로컬은 `decidedBy='local-user'` 폴백.

### i18n 네임스페이스

`locales/{ko,en,ja}/app.json`에 `wiki.*`(title·empty·source·search_placeholder·all_sources·all_categories·edit·delete·save·cancel·delete_confirm·category_none·save_failed·delete_failed), `approval.*`(title·approve·revise·abort·feedback_placeholder·remember_auto·save_to_wiki·**wiki_summary** #212), `settings.*`(server_url·mode·user_id·language·lang_*·**gate_mode**·gate_mode_manual·gate_mode_auto #215) 네임스페이스가 추가되어 있다.

**내비/패널 i18n 일괄(#227):** `activity_bar.*`(chat·github·mcp·plugins·**wiki**·**decisions** #306·settings)·`status_bar.*`(server·running·stopped·checking·mcp_count)·`right_panel.*`(output_title·waiting·tokens·elapsed·modified_files) 네임스페이스 신규 + `github.*`·`plugins.*`·`command_palette.*`·`sidebar.*` 확장. **`decisions.*`(title·empty·loading·refresh·location·expected_vs_actual·impact·evidence·attribution·choice_*×4·choice_approve·choice_hint·submit_failed·submitted, #306·`choice_noop_hint` 제거→`choice_approve`/`choice_hint` 대체 #318·`type_defect_brief`/`type_risk_classification`/`type_degraded_release`/`type_degraded_dispatch` 결정 type 배지 #333)**. `ActivityBar`·`StatusBar`·`RightPanel`·`Sidebar`·`GitHubPanel`·`PluginPanel`·`CommandPalette`가 `useTranslation('app')`로 렌더(CommandPalette의 cmdk `value=`는 로케일 무관 필터 식별자로 유지). app.json **160키** 3로케일 동기화(`node scripts/check-i18n.js`·+`chat.mode_chat`/`chat.mode_build` MessageInput Chat|Build 토글 #339). ⚠️ 잔여 하드코딩 한국어(후속 i18n 배치 예정): `ChatView`(empty-state 안내)·`McpPanel`(env 파싱 toast)·`MessageInput`(전송 aria-label)·`AgentTimelineCard`·`CodeBlock`·`PipelineStrip`·`ProjectContextBar`.

문자열 추가 시 3개 로케일 동기화 필수.

## 환경 변수

```env
# 공통
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3000
MODE=local
AUTH=none                         # none | jwt
SERVICE_JWT_SECRET=               # AUTH=jwt 시 필수 (32자 이상)
USER_JWT_SECRET=                  # 사용자 JWT access token 서명 키
CLAUDE_MODE=api                   # api | cli | remote

# 서버 간 연결
MANAGER_URL=http://localhost:3001 # Manager 서비스 URL
PAIS_PROFILE=                     # 선택(G1·프리미엄 one-switch·Manager와 대칭). 설정 시 config.ts resolveProfileEnv가 parse 전에 프로필 기본값을 env에 병합(개별 env override 우선·미지 프로필→throw). autonomous → ORCHESTRATOR_DECOMPOSE_ENABLED=true(build 라우팅 활성). 자율 스택 대부분·JWT/DB 하드요구는 Manager PAIS_PROFILE이 담당(두 서비스에 같은 값 설정). off→회귀 0
ORCHESTRATOR_DECOMPOSE_ENABLED=   # 선택: 기본 false(C6·#337). true면 POST messages `mode:'build'`을 decompose_request로 라우팅(자율 태스크그래프). off면 모든 메시지가 chat(task_request)·byte-identical. **config.decomposeEnabled로 일원화**(이전엔 server.ts가 process.env 직접 읽음 — PAIS_PROFILE 병합 위해 config 경유). ⚠️실 활성엔 Manager의 MANAGER_DECOMPOSE_ENABLED+TASK_MANAGER_ENABLED 필요(off면 Manager가 error 발행). ⚠️build 모드는 절대 WORKSPACE_ROOT 필요(Manager AbsoluteUserContextSchema)

# 세션 WebSocket
WS_CLEANUP_GRACE_MS=15000         # WS 끊김 후 세션 정리까지 대기하는 grace 기간(ms, 기본 15000)

# 데이터베이스
DATABASE_URL=                     # SQLite 파일 경로 또는 연결 문자열

# GitHub PAT 암호화 (AES-256-GCM)
GITHUB_TOKEN_ENCRYPTION_KEY=      # 32바이트 hex 문자열 (64자)

# 원격 모드 (CLAUDE_MODE=remote 시)
REMOTE_CLI_URL=                   # HTTP 원격 서버 URL (설정 시 SSH 무시)
REMOTE_HOST=                      # SSH 호스트
REMOTE_USER=                      # SSH 사용자
REMOTE_KEY_PATH=~/.ssh/id_rsa     # SSH 개인키 경로
```

## Claude 실행 모드

`CLAUDE_MODE` 환경변수로 전환:
- `api` (기본): Anthropic SDK 직접 호출 (`APIRunner`, ANTHROPIC_API_KEY 필요)
- `cli`: 로컬 claude CLI 서브프로세스 (`CLIRunner`) — 2026-06-15 이후 Agent SDK 추가 요금 발생
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

전체 패턴: [docs/development/security-patterns.md](../../docs/development/security-patterns.md)

**이 서비스 고유 패턴**:
- CLI 플래그 인젝션 방지: `cli-runner.ts`에서 `'--'` end-of-options 구분자 사용
- OAuth CSRF 방지: `randomBytes(32)` state → 콜백 검증 (`github-oauth-handler.ts`)
- MCP 프로세스 보안: command allowlist + 위험 args 차단 (`mcp-process-manager.ts`)
- 토큰 렌더러 노출 금지: GitHub 토큰은 main 프로세스에서만 접근
- WebSocket 인증: `Sec-WebSocket-Protocol: bearer.<token>` 폴백 (`user-auth.hook.ts`)
- 클라이언트 토큰 전달(#229): `useAuthStore.accessToken`를 `createSession`·`postMessage`·`postUiAction`는 `Authorization: Bearer`로, `SessionWsClient.connect`는 `Sec-WebSocket-Protocol: bearer.<token>`로 전달 — `AUTH=jwt`에서 Electron 앱이 세션·메시지·WS 인증을 통과한다. 토큰은 디스크 재조회 없이 메모리 스토어 값만 사용(`tokenStorage`의 렌더러 read-back 금지 유지). 앱 시작 토큰 복원 중에는 `useAuthStore.isRestoring` 가드(`App.tsx` `RequireAuth`·`RootRedirect`)가 성급한 `/login` 리다이렉트를 보류한다. 클라이언트 WS 자동 재연결(④b)은 `useSessionWs`에 지수 백오프 + 최신 토큰 재첨부로 구현 완료(#231).

## 관련 프로젝트

xzawed suite: 현재 저장소 루트
- 9개 서비스 모두 구현 완료: xzawedManager(3001), xzawedPlanner(3002), xzawedDeveloper(3003), xzawedDesigner(3004), xzawedTester(3005), xzawedBuilder(3006), xzawedWatcher(3007), xzawedSecurity(3008)
- Redis Streams 통신 포맷: `docs/specs/2026-05-15-orchestrator-design.md` 참고

## 형제 프로젝트

- **SCAManager** — Python 3.14 FastAPI backend with PostgreSQL, static analysis pipeline, Claude AI code review
- **ArcanaInsight** — TypeScript/Next.js + React, Supabase, Grok/Claude AI
