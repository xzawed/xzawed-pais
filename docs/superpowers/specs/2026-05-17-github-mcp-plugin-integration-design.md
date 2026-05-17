# GitHub · MCP · Plugin 통합 관리 설계

**날짜:** 2026-05-17  
**상태:** 승인됨  
**대상 서비스:** xzawedOrchestrator (Electron 앱), xzawedManager

---

## 개요

xzawed 플랫폼이 생성한 서비스를 GitHub에서 관리하고, MCP 서버와 Claude Code 플러그인을 Electron UI에서 직접 설치·운용할 수 있도록 통합 관리 기능을 추가한다.

---

## 1. 네비게이션 구조 — 반응형 사이드바

### 동작 방식

창 너비 900px를 기준으로 사이드바 모드가 자동 전환된다.

| 모드 | 조건 | 사이드바 너비 | 표시 방식 |
|---|---|---|---|
| 아이콘 레일 (compact) | `innerWidth < 900px` | 44px | 아이콘만, 마우스 오버 시 툴팁 |
| 텍스트 메뉴 (expanded) | `innerWidth >= 900px` | 200px | 아이콘 + 텍스트 레이블 |

- CSS `transition: width 200ms ease` 로 부드러운 전환
- 사이드바 상단 토글 버튼으로 수동 고정 가능, `integrations.store.ts`에 저장
- ResizeObserver로 창 크기 실시간 감지

### 사이드바 메뉴 구성

```
[ + New Session ]
──────────────────
  최근 세션 목록
──────────────────  ← 구분선
  🐙 GitHub
  🔌 MCP 서버
  📦 Plugins
──────────────────
  ⚙️ 일반 설정
```

각 메뉴 클릭 시 채팅 패널 자리에 해당 패널이 전체 렌더링된다. 세션 활성 중 GitHub·MCP·Plugin 메뉴를 클릭하면 채팅으로 돌아오는 뒤로가기 버튼을 제공한다.

---

## 2. GitHub 통합

### 2-1. 인증 방식 — OAuth (브라우저 로그인)

```
사용자 [GitHub 연결] 클릭
  → Electron main: 임시 로컬 HTTP 서버 포트 오픈 (예: 54321)
  → shell.openExternal(GitHub OAuth 인증 URL)
  → 브라우저에서 사용자 승인
  → GitHub → localhost:54321/callback?code=xxx 리다이렉트
  → Electron main: code로 access_token 교환 (GitHub OAuth App)
  → safeStorage.encryptString(token) → 로컬 암호화 저장
  → IPC → Renderer: 연결 완료 상태 업데이트
```

**필요 사전 설정:** GitHub OAuth App 등록 (Client ID / Client Secret). 앱 배포 시 번들에 포함하거나 사용자가 직접 입력하는 방식 중 하나 선택 — 구현 시 결정.

**토큰 저장:** `electron.safeStorage` (OS 키체인 연동). 평문 저장 금지.

### 2-2. GitHub 패널 UI

- **미연결 상태:** 계정 연결 안내 + [GitHub 연결] 버튼
- **연결됨 상태:** 프로필 아바타, 사용자명, [연결 해제] 버튼
- **레포지토리 목록:** 연결된 계정의 레포 목록 (검색 가능)
- **기본 레포 설정:** 세션 시작 시 사용할 기본 레포 지정

### 2-3. 지원 기능

| 기능 | 설명 |
|---|---|
| 저장소 생성 | 새 프로젝트 시작 시 GitHub에 repo 자동 생성 |
| 브랜치 생성/관리 | feature 브랜치 생성, 목록 조회 |
| 코드 커밋 & Push | Developer 에이전트 작업 결과를 커밋하여 push |
| Pull Request 생성 | 작업 완료 후 PR 자동 생성 (타이틀·본문 자동 작성) |
| 이슈 생성 및 연결 | 작업 내용을 이슈로 생성하고 PR에 연결 |
| 브랜치 머지 | PR 승인 후 머지 실행 |

### 2-4. xzawedManager — github-ops ToolHandler

기존 7개 ToolHandler와 동일한 `RedisAgentHandler` 팩토리 패턴으로 구현한다.

```typescript
// 신규 파일: xzawedManager/packages/server/src/tools/github-ops.ts
export function createGithubOpsHandler(redisUrl: string): ToolHandler

// 지원 액션
type GithubAction =
  | 'createRepo'
  | 'createBranch'
  | 'commitAndPush'
  | 'createPR'
  | 'createIssue'
  | 'mergeBranch'
  | 'listRepos'
  | 'listBranches'
```

**의존성 추가:** `@octokit/rest` (GitHub REST API 클라이언트)

**토큰 전달 경로:**
```
Electron safeStorage
  → IPC → xzawedOrchestrator 환경변수
  → Redis Streams 메시지 payload.githubToken
  → xzawedManager github-ops handler
```

**환경변수 추가 (xzawedManager/.env):**
```env
GITHUB_TOKEN=  # Orchestrator가 세션별로 전달, 직접 설정도 가능
```

### 2-5. 세션 작업 흐름 예시

```
사용자: "my-app 레포에 로그인 기능 추가해줘"
  → Manager: github-ops.createBranch(feat/login-feature)
  → Manager: plan-task → Planner가 Step[] 생성
  → Manager: develop-code → Developer가 코드 생성
  → Manager: github-ops.commitAndPush(feat/login-feature)
  → Manager: design-ui → Designer가 UI 스펙 생성
  → Manager: github-ops.commitAndPush(feat/login-feature)
  → Manager: run-tests → Tester 실행
  → Manager: github-ops.createPR + createIssue 연결
  → 사용자: GitHub에서 PR 확인 · 머지
```

---

## 3. MCP 서버 관리

### 3-1. MCP 패널 UI — 추천 스토어 + 직접 추가

탭 구성:
- **설치됨** — 현재 설치된 서버 목록, 실행 상태(●/○), 설정, 시작/중지
- **추천 서버** — 카드 그리드, 버튼 한 번으로 설치
- **직접 추가** — 이름 + 실행 명령어 + 환경변수(키-값) 입력 폼

### 3-2. 추천 서버 목록 (초기)

| 서버 | 설명 | 실행 명령어 |
|---|---|---|
| context7 | 라이브러리 문서 검색 | `npx @upstash/context7-mcp` |
| playwright | 브라우저 자동화 | `npx @playwright/mcp` |
| supabase | Supabase DB 연동 | `npx @supabase/mcp-server-supabase` |
| github | GitHub 저장소 검색 | `npx @modelcontextprotocol/server-github` |
| filesystem | 파일시스템 접근 | `npx @modelcontextprotocol/server-filesystem` |

### 3-3. McpProcessManager (Electron main process)

```typescript
// 신규: packages/app/src/main/mcp-process-manager.ts
interface McpServerConfig {
  id: string
  name: string
  command: string       // 예: "npx"
  args: string[]        // 예: ["@upstash/context7-mcp"]
  env?: Record<string, string>
  autoStart: boolean
}

class McpProcessManager {
  start(config: McpServerConfig): Promise<void>
  stop(id: string): Promise<void>
  restart(id: string): Promise<void>
  getStatus(id: string): 'running' | 'stopped' | 'error'
  getAll(): McpServerConfig[]
}
```

**IPC 채널:**
- `mcp:list` — 전체 서버 목록 + 상태 반환
- `mcp:start` / `mcp:stop` / `mcp:restart`
- `mcp:add` / `mcp:remove`

**설정 저장:** `~/.userData/mcp-servers.json`

---

## 4. Plugin 관리

### 4-1. Plugin 패널 UI — 통합 목록 + 뱃지 구분

단일 목록에 모든 플러그인을 표시. 종류는 뱃지로 구분:

- **Claude Code** (보라 `#6e40c9`) — `npx skills add` 방식으로 설치
- **xzawed** (파랑 `#1f6feb`) — xzawed 플랫폼 전용 확장 모듈

**상단 컨트롤:**
- 검색 인풋 (이름·설명 필터)
- 종류 필터 드롭다운 (전체 / Claude Code / xzawed)

**각 플러그인 카드:**
- 아이콘, 이름, 버전, 설명, 뱃지
- 활성/비활성 토글 스위치
- 업데이트 있을 시 노란 뱃지
- 더보기 메뉴: 상세 정보, 제거

### 4-2. PluginManager (Electron main process)

```typescript
// 신규: packages/app/src/main/plugin-manager.ts
interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  type: 'claude-code' | 'xzawed'
  enabled: boolean
  installPath: string
}

class PluginManager {
  list(): PluginInfo[]
  install(packageName: string, type: PluginInfo['type']): Promise<void>  // npx or npm
  uninstall(id: string): Promise<void>
  enable(id: string): void
  disable(id: string): void
  checkUpdates(): Promise<Record<string, string>>  // id → latestVersion
}
```

**IPC 채널:**
- `plugin:list` — 설치된 플러그인 목록
- `plugin:install` / `plugin:uninstall`
- `plugin:enable` / `plugin:disable`
- `plugin:check-updates`

**Claude Code 플러그인 경로:** `~/.claude/plugins/`  
**xzawed 확장 경로:** `~/.userData/xzawed-extensions/`

---

## 5. 신규 Zustand Store

```typescript
// 신규: packages/app/src/renderer/src/store/integrations.store.ts

interface IntegrationsStore {
  // GitHub
  github: {
    connected: boolean
    username: string | null
    avatarUrl: string | null
    defaultRepo: string | null
    repos: GitHubRepo[]
  }
  // MCP
  mcp: {
    servers: McpServerConfig[]
    statuses: Record<string, 'running' | 'stopped' | 'error'>
  }
  // Plugins
  plugins: {
    list: PluginInfo[]
    sidebarMode: 'compact' | 'expanded' | 'auto'
  }
  // Actions
  connectGitHub: () => Promise<void>
  disconnectGitHub: () => void
  setDefaultRepo: (repo: string) => void
  addMcpServer: (config: McpServerConfig) => Promise<void>
  removeMcpServer: (id: string) => Promise<void>
  toggleMcpServer: (id: string) => Promise<void>
  installPlugin: (pkg: string, type: string) => Promise<void>
  uninstallPlugin: (id: string) => Promise<void>
  togglePlugin: (id: string) => void
  setSidebarMode: (mode: 'compact' | 'expanded' | 'auto') => void
}
```

---

## 6. 변경 파일 목록

### xzawedOrchestrator/packages/app

| 파일 | 변경 유형 |
|---|---|
| `src/main/index.ts` | 변경 — IPC 채널 추가 |
| `src/main/github-oauth-handler.ts` | 신규 |
| `src/main/mcp-process-manager.ts` | 신규 |
| `src/main/plugin-manager.ts` | 신규 |
| `src/preload/index.ts` | 변경 — 신규 IPC 채널 노출 |
| `src/renderer/src/App.tsx` | 변경 — 패널 라우팅 |
| `src/renderer/src/components/Sidebar.tsx` | 변경 — 반응형 + 신규 메뉴 |
| `src/renderer/src/components/GitHubPanel.tsx` | 신규 |
| `src/renderer/src/components/McpPanel.tsx` | 신규 |
| `src/renderer/src/components/PluginPanel.tsx` | 신규 |
| `src/renderer/src/store/integrations.store.ts` | 신규 |
| `src/renderer/src/electron.d.ts` | 변경 — 신규 API 타입 |
| `src/renderer/src/App.css` | 변경 — 반응형 사이드바, 패널 스타일 |

### xzawedManager/packages/server

| 파일 | 변경 유형 |
|---|---|
| `src/tools/github-ops.ts` | 신규 |
| `src/tools/index.ts` | 변경 — github-ops 등록 |
| `src/config.ts` | 변경 — GITHUB_TOKEN 환경변수 추가 |
| `.env.example` | 변경 — GITHUB_TOKEN 항목 추가 |
| `package.json` | 변경 — @octokit/rest 추가 |

---

## 7. 테스트 계획

### Electron 앱
- `integrations.store.test.ts` — GitHub 상태 전환, MCP 목록, Plugin 목록
- `github-oauth-handler.test.ts` — 콜백 파싱, 토큰 교환 Mock
- `mcp-process-manager.test.ts` — 프로세스 스폰·종료 Mock
- `plugin-manager.test.ts` — 설치·제거·토글 Mock

### xzawedManager
- `github-ops.test.ts` — Octokit Mock으로 각 액션 단위 테스트 (7개 액션 × 성공/실패)

---

## 8. 미결 사항

- **GitHub OAuth App 등록 주체:** 앱 배포용 공식 OAuth App을 xzawed 조직 명의로 등록할지, 사용자가 개인 OAuth App을 직접 등록해서 Client ID/Secret을 입력할지 결정 필요.
- **WORKSPACE_ROOT와 GitHub 레포 연결:** Developer가 파일을 쓰는 로컬 경로와 GitHub 레포의 매핑 방식 구체화 필요 (git clone 경로 관리).
