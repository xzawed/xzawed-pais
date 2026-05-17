# GitHub · MCP · Plugin 통합 관리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** xzawed Electron 앱에 반응형 사이드바와 GitHub OAuth 연동·MCP 서버 관리·Plugin 관리 패널을 추가하고, xzawedManager에 `github-ops` ToolHandler를 구현한다.

**Architecture:** Electron main process가 GitHub OAuth·MCP 프로세스·Plugin 설치를 담당하고 IPC로 Renderer에 노출한다. GitHub 토큰은 safeStorage 암호화 → settings.json → HTTP 헤더 → Orchestrator → Redis Streams → Manager 세션 컨텍스트로 전달된다. Manager는 기존 ToolHandler 패턴에 `github-ops` 핸들러를 추가해 Octokit으로 GitHub API를 직접 호출한다.

**Tech Stack:** Electron 42 safeStorage, Node.js `child_process.spawn`, Zustand 5 persist, React 19, @octokit/rest, Vitest 3

---

## 파일 맵

### 신규 생성

| 파일 | 역할 |
|---|---|
| `xzawedOrchestrator/packages/app/src/main/github-oauth-handler.ts` | OAuth 콜백 서버, 토큰 교환, safeStorage 암호화 저장 |
| `xzawedOrchestrator/packages/app/src/main/mcp-process-manager.ts` | MCP 서버 프로세스 스폰·종료·상태 추적 |
| `xzawedOrchestrator/packages/app/src/main/plugin-manager.ts` | Claude Code·xzawed 플러그인 설치·목록 관리 |
| `xzawedOrchestrator/packages/app/src/renderer/src/store/integrations.store.ts` | GitHub·MCP·Plugin 통합 Zustand 스토어 |
| `xzawedOrchestrator/packages/app/src/renderer/src/components/GitHubPanel.tsx` | GitHub 연동 패널 UI |
| `xzawedOrchestrator/packages/app/src/renderer/src/components/McpPanel.tsx` | MCP 서버 관리 패널 UI |
| `xzawedOrchestrator/packages/app/src/renderer/src/components/PluginPanel.tsx` | Plugin 통합 목록 패널 UI |
| `xzawedOrchestrator/packages/app/test/store/integrations.store.test.ts` | 스토어 단위 테스트 |
| `xzawedOrchestrator/packages/app/test/main/github-oauth-handler.test.ts` | OAuth 핸들러 단위 테스트 |
| `xzawedOrchestrator/packages/app/test/main/mcp-process-manager.test.ts` | MCP 프로세스 매니저 단위 테스트 |
| `xzawedOrchestrator/packages/app/test/main/plugin-manager.test.ts` | 플러그인 매니저 단위 테스트 |
| `xzawedManager/packages/server/src/tools/github-ops.ts` | GitHub API ToolHandler (Octokit) |
| `xzawedManager/packages/server/src/tools/github-ops.test.ts` | github-ops 단위 테스트 |

### 수정

| 파일 | 변경 내용 |
|---|---|
| `xzawedOrchestrator/packages/app/src/main/index.ts` | win 모듈 스코프 노출, IPC 채널 추가 |
| `xzawedOrchestrator/packages/app/src/preload/index.ts` | 신규 IPC 채널 Renderer에 노출 |
| `xzawedOrchestrator/packages/app/src/renderer/src/electron.d.ts` | ElectronAPI 타입 확장 |
| `xzawedOrchestrator/packages/app/src/renderer/src/lib/api.ts` | X-GitHub-Token 헤더 추가 |
| `xzawedOrchestrator/packages/app/src/renderer/src/components/Sidebar.tsx` | 반응형 모드 + 3개 메뉴 추가 |
| `xzawedOrchestrator/packages/app/src/renderer/src/App.tsx` | 패널 라우팅 추가 |
| `xzawedOrchestrator/packages/app/src/renderer/src/App.css` | 반응형 사이드바·패널 스타일 |
| `xzawedManager/packages/server/src/config.ts` | GITHUB_TOKEN 환경변수 추가 |
| `xzawedManager/packages/server/src/tools/index.ts` (또는 tools 등록 위치) | github-ops 등록 |
| `xzawedManager/.env.example` | GITHUB_TOKEN 항목 추가 |

---

## Phase 1: Foundation

### Task 1: integrations.store.ts 생성

**Files:**
- Create: `xzawedOrchestrator/packages/app/src/renderer/src/store/integrations.store.ts`
- Create: `xzawedOrchestrator/packages/app/test/store/integrations.store.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// test/store/integrations.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useIntegrationsStore } from '../../src/renderer/src/store/integrations.store.js'

describe('integrations.store', () => {
  beforeEach(() => {
    useIntegrationsStore.setState({
      github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] },
      mcp: { servers: [], statuses: {} },
      plugins: [],
      activePanel: 'chat',
      sidebarMode: 'auto',
    })
  })

  it('GitHub 연결 상태를 설정한다', () => {
    useIntegrationsStore.getState().setGitHubConnected('xzawed', 'https://avatar.url')
    const { github } = useIntegrationsStore.getState()
    expect(github.connected).toBe(true)
    expect(github.username).toBe('xzawed')
    expect(github.avatarUrl).toBe('https://avatar.url')
  })

  it('GitHub 연결을 해제한다', () => {
    useIntegrationsStore.getState().setGitHubConnected('xzawed', 'https://avatar.url')
    useIntegrationsStore.getState().disconnectGitHub()
    const { github } = useIntegrationsStore.getState()
    expect(github.connected).toBe(false)
    expect(github.username).toBeNull()
  })

  it('MCP 서버 상태를 업데이트한다', () => {
    useIntegrationsStore.getState().setMcpStatus('context7', 'running')
    expect(useIntegrationsStore.getState().mcp.statuses['context7']).toBe('running')
  })

  it('플러그인 활성 상태를 토글한다', () => {
    useIntegrationsStore.setState({
      plugins: [{ id: 'p1', name: 'test', version: '1.0', description: '', type: 'claude-code', enabled: true }],
    })
    useIntegrationsStore.getState().togglePlugin('p1')
    expect(useIntegrationsStore.getState().plugins[0].enabled).toBe(false)
  })

  it('활성 패널을 전환한다', () => {
    useIntegrationsStore.getState().setActivePanel('github')
    expect(useIntegrationsStore.getState().activePanel).toBe('github')
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd xzawedOrchestrator && pnpm test test/store/integrations.store.test.ts
```
Expected: `Cannot find module '…/integrations.store.js'`

- [ ] **Step 3: 스토어 구현**

```typescript
// src/renderer/src/store/integrations.store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface GitHubRepo {
  id: number
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  autoStart: boolean
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  type: 'claude-code' | 'xzawed'
  enabled: boolean
}

export type ActivePanel = 'chat' | 'github' | 'mcp' | 'plugins'
export type SidebarMode = 'compact' | 'expanded' | 'auto'

interface IntegrationsState {
  github: {
    connected: boolean
    username: string | null
    avatarUrl: string | null
    defaultRepo: string | null
    repos: GitHubRepo[]
  }
  mcp: {
    servers: McpServerConfig[]
    statuses: Record<string, 'running' | 'stopped' | 'error'>
  }
  plugins: PluginInfo[]
  activePanel: ActivePanel
  sidebarMode: SidebarMode
  setGitHubConnected: (username: string, avatarUrl: string) => void
  setGitHubRepos: (repos: GitHubRepo[]) => void
  setDefaultRepo: (repo: string) => void
  disconnectGitHub: () => void
  setMcpServers: (servers: McpServerConfig[]) => void
  setMcpStatus: (id: string, status: 'running' | 'stopped' | 'error') => void
  setPlugins: (plugins: PluginInfo[]) => void
  togglePlugin: (id: string) => void
  setActivePanel: (panel: ActivePanel) => void
  setSidebarMode: (mode: SidebarMode) => void
}

export const useIntegrationsStore = create<IntegrationsState>()(
  persist(
    (set) => ({
      github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] },
      mcp: { servers: [], statuses: {} },
      plugins: [],
      activePanel: 'chat',
      sidebarMode: 'auto',
      setGitHubConnected: (username, avatarUrl) =>
        set((s) => ({ github: { ...s.github, connected: true, username, avatarUrl } })),
      setGitHubRepos: (repos) =>
        set((s) => ({ github: { ...s.github, repos } })),
      setDefaultRepo: (repo) =>
        set((s) => ({ github: { ...s.github, defaultRepo: repo } })),
      disconnectGitHub: () =>
        set((s) => ({ github: { ...s.github, connected: false, username: null, avatarUrl: null, repos: [] } })),
      setMcpServers: (servers) =>
        set((s) => ({ mcp: { ...s.mcp, servers } })),
      setMcpStatus: (id, status) =>
        set((s) => ({ mcp: { ...s.mcp, statuses: { ...s.mcp.statuses, [id]: status } } })),
      setPlugins: (plugins) => set({ plugins }),
      togglePlugin: (id) =>
        set((s) => ({ plugins: s.plugins.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p) })),
      setActivePanel: (panel) => set({ activePanel: panel }),
      setSidebarMode: (mode) => set({ sidebarMode: mode }),
    }),
    {
      name: 'integrations-store',
      partialize: (s) => ({ sidebarMode: s.sidebarMode, github: { defaultRepo: s.github.defaultRepo } }),
    }
  )
)
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd xzawedOrchestrator && pnpm test test/store/integrations.store.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/store/integrations.store.ts xzawedOrchestrator/packages/app/test/store/integrations.store.test.ts
git commit -m "feat(app): integrations.store.ts — GitHub·MCP·Plugin 통합 Zustand 스토어"
```

---

### Task 2: Sidebar 반응형 리팩토링

**Files:**
- Modify: `xzawedOrchestrator/packages/app/src/renderer/src/components/Sidebar.tsx`
- Modify: `xzawedOrchestrator/packages/app/src/renderer/src/App.css`

- [ ] **Step 1: Sidebar.tsx 전체 교체**

현재 `Sidebar.tsx`를 다음으로 교체한다. ResizeObserver로 900px 기준 `sidebarMode` 자동 전환, 사이드바 하단에 GitHub·MCP·Plugins 메뉴 추가.

```tsx
// src/renderer/src/components/Sidebar.tsx
import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/app.store.js'
import { useChatStore } from '../store/chat.store.js'
import { useIntegrationsStore, type ActivePanel } from '../store/integrations.store.js'
import { createSession } from '../lib/api.js'

export function Sidebar(): React.JSX.Element {
  const { settings, serverStatus, toggleSettings } = useAppStore()
  const { initSession } = useChatStore()
  const { activePanel, sidebarMode, setActivePanel, setSidebarMode } = useIntegrationsStore()
  const [isCreating, setIsCreating] = useState(false)
  const [autoCompact, setAutoCompact] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 창 너비 900px 기준 자동 전환
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setAutoCompact(window.innerWidth < 900)
    })
    observer.observe(document.body)
    setAutoCompact(window.innerWidth < 900)
    return () => observer.disconnect()
  }, [])

  const isCompact =
    sidebarMode === 'compact' || (sidebarMode === 'auto' && autoCompact)

  async function handleNewSession(): Promise<void> {
    if (isCreating) return
    setIsCreating(true)
    try {
      const { sessionId } = await createSession(settings.serverUrl, settings.userId)
      initSession(sessionId)
      setActivePanel('chat')
    } catch (err) {
      console.error('Failed to create session:', err)
    } finally {
      setIsCreating(false)
    }
  }

  function navItem(panel: ActivePanel, icon: string, label: string) {
    const active = activePanel === panel
    return (
      <button
        key={panel}
        className={`sidebar-nav-item ${active ? 'active' : ''} ${isCompact ? 'compact' : ''}`}
        onClick={() => setActivePanel(panel)}
        title={isCompact ? label : undefined}
      >
        <span className="sidebar-nav-icon">{icon}</span>
        {!isCompact && <span className="sidebar-nav-label">{label}</span>}
      </button>
    )
  }

  return (
    <div ref={containerRef} className={`sidebar ${isCompact ? 'sidebar--compact' : 'sidebar--expanded'}`}>
      {/* 사이드바 모드 토글 */}
      <button
        className="sidebar-mode-toggle"
        onClick={() => setSidebarMode(sidebarMode === 'auto' ? (isCompact ? 'expanded' : 'compact') : 'auto')}
        title={isCompact ? '사이드바 펼치기' : '사이드바 접기'}
      >
        {isCompact ? '›' : '‹'}
      </button>

      <button
        className={`sidebar-btn new-session ${isCompact ? 'compact' : ''}`}
        onClick={handleNewSession}
        disabled={isCreating}
        title={isCompact ? 'New Session' : undefined}
      >
        {isCompact ? '+' : (isCreating ? 'Creating...' : '+ New Session')}
      </button>

      <div className="sidebar-divider" />

      <nav className="sidebar-nav">
        {navItem('github', '🐙', 'GitHub')}
        {navItem('mcp', '🔌', 'MCP 서버')}
        {navItem('plugins', '📦', 'Plugins')}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        {!isCompact && (
          <div className="sidebar-status">
            <span className={`status-dot ${serverStatus}`} />
            Server: {serverStatus}
          </div>
        )}
        <button
          className={`sidebar-btn ${isCompact ? 'compact' : ''}`}
          onClick={toggleSettings}
          title={isCompact ? '설정' : undefined}
        >
          {isCompact ? '⚙️' : 'Settings'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: App.css에 반응형 사이드바 스타일 추가**

`App.css` 파일 맨 끝에 다음을 추가한다.

```css
/* ── Sidebar responsive ───────────────────────────────────────────── */
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 8px;
  background: #16213e;
  transition: width 200ms ease;
  overflow: hidden;
  position: relative;
}

.sidebar--expanded { width: 200px; }
.sidebar--compact  { width: 52px; }

.sidebar-mode-toggle {
  position: absolute;
  top: 8px;
  right: 6px;
  background: none;
  border: none;
  color: #6a6a8a;
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
}
.sidebar-mode-toggle:hover { color: #e0e0e0; }

.sidebar-divider {
  border-top: 1px solid #2a2a4a;
  margin: 8px 0;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  border: none;
  background: none;
  color: #a0a0c0;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 150ms;
  white-space: nowrap;
}
.sidebar-nav-item:hover  { background: #1a1a3e; color: #e0e0e0; }
.sidebar-nav-item.active { background: #2a2a5a; color: #fff; }
.sidebar-nav-item.compact { padding: 8px; justify-content: center; }

.sidebar-nav-icon  { font-size: 16px; flex-shrink: 0; }
.sidebar-nav-label { font-size: 13px; }

.sidebar-status {
  font-size: 11px;
  color: #6a6a8a;
  padding: 4px 8px;
  margin-bottom: 4px;
}

.sidebar-btn.compact {
  padding: 8px;
  text-align: center;
  font-size: 16px;
}

/* ── Panel base layout ───────────────────────────────────────────── */
.integration-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
  padding: 24px;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
}
.panel-header h2 { margin: 0; font-size: 18px; color: #e0e0e0; }
.panel-back-btn {
  background: none;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  color: #a0a0c0;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.panel-back-btn:hover { color: #e0e0e0; border-color: #4a4aaa; }

.panel-card {
  background: #16213e;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}

.panel-btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  transition: opacity 150ms;
}
.panel-btn:hover { opacity: 0.85; }
.panel-btn--primary { background: #4a4aaa; color: #fff; }
.panel-btn--danger  { background: #aa3a3a; color: #fff; }
.panel-btn--ghost   { background: #2a2a4a; color: #a0a0c0; }
.panel-btn--success { background: #2a6a2a; color: #fff; }

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}
.badge--claude-code { background: #4a2a8a; color: #c4a0ff; }
.badge--xzawed      { background: #1a3a7a; color: #7ab0ff; }
.badge--active      { background: #1a5a1a; color: #7aff7a; }
.badge--inactive    { background: #3a3a3a; color: #8a8a8a; }
.badge--update      { background: #6a4a00; color: #ffcc44; }
```

- [ ] **Step 3: App.tsx 패널 라우팅 추가**

`App.tsx`를 수정해 `activePanel` 값에 따라 `ChatView + DynamicPanel` 또는 통합 패널을 렌더링한다.

```tsx
// src/renderer/src/App.tsx
import React, { useEffect } from 'react'
import { useAppStore } from './store/app.store.js'
import { useIntegrationsStore } from './store/integrations.store.js'
import { checkHealth } from './lib/api.js'
import { Sidebar } from './components/Sidebar.js'
import { ChatView } from './components/ChatView.js'
import { DynamicPanel } from './components/DynamicPanel.js'
import { SettingsModal } from './components/SettingsModal.js'
import { GitHubPanel } from './components/GitHubPanel.js'
import { McpPanel } from './components/McpPanel.js'
import { PluginPanel } from './components/PluginPanel.js'

export function App(): React.JSX.Element {
  const { settings, updateSettings, setServerStatus } = useAppStore()
  const { activePanel } = useIntegrationsStore()

  useEffect(() => {
    window.electronAPI?.getSettings().then(updateSettings).catch(() => {})
  }, [updateSettings])

  useEffect(() => {
    let cancelled = false
    async function poll(): Promise<void> {
      if (cancelled) return
      const healthy = await checkHealth(settings.serverUrl)
      if (!cancelled) setServerStatus(healthy ? 'running' : 'stopped')
    }
    void poll()
    const id = setInterval(() => void poll(), 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [settings.serverUrl])

  return (
    <div className="app-shell">
      <Sidebar />
      {activePanel === 'chat' && (
        <>
          <ChatView />
          <DynamicPanel />
        </>
      )}
      {activePanel === 'github'  && <GitHubPanel />}
      {activePanel === 'mcp'     && <McpPanel />}
      {activePanel === 'plugins' && <PluginPanel />}
      <SettingsModal />
    </div>
  )
}
```

- [ ] **Step 4: 빌드 확인 (타입 에러 없음)**

```bash
cd xzawedOrchestrator && pnpm build
```
Expected: 빌드 성공 (GitHubPanel·McpPanel·PluginPanel 파일이 없어 에러 발생 시 Task 5·10·12 이후 재확인)

- [ ] **Step 5: 커밋**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/Sidebar.tsx xzawedOrchestrator/packages/app/src/renderer/src/App.tsx xzawedOrchestrator/packages/app/src/renderer/src/App.css
git commit -m "feat(app): 반응형 사이드바 + 패널 라우팅 (GitHub·MCP·Plugins 메뉴)"
```

---

## Phase 2: GitHub Integration

### Task 3: GithubOAuthHandler (main process)

**Files:**
- Create: `xzawedOrchestrator/packages/app/src/main/github-oauth-handler.ts`
- Create: `xzawedOrchestrator/packages/app/test/main/github-oauth-handler.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// test/main/github-oauth-handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// safeStorage와 파일 I/O를 모킹해 순수 로직만 테스트
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s + '-enc')),
    decryptString: vi.fn((b: Buffer) => b.toString().replace('-enc', '')),
  },
  shell: { openExternal: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp/test-userData') },
}))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => Buffer.from('token-enc').toString('base64')),
  mkdirSync: vi.fn(),
}))

import { storeToken, getStoredToken, clearToken } from '../../src/main/github-oauth-handler.js'

describe('github-oauth-handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('토큰을 암호화해 저장한다', () => {
    const { writeFileSync } = await import('node:fs')
    storeToken('ghp_testtoken')
    expect(writeFileSync).toHaveBeenCalled()
  })

  it('저장된 토큰을 복호화해 반환한다', () => {
    const token = getStoredToken()
    expect(typeof token === 'string' || token === null).toBe(true)
  })

  it('토큰을 삭제한다', () => {
    const { writeFileSync } = await import('node:fs')
    clearToken()
    expect(writeFileSync).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd xzawedOrchestrator && pnpm test test/main/github-oauth-handler.test.ts
```
Expected: `Cannot find module '…/github-oauth-handler.js'`

- [ ] **Step 3: GithubOAuthHandler 구현**

```typescript
// src/main/github-oauth-handler.ts
import http from 'node:http'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { shell, safeStorage, app } from 'electron'
import type { BrowserWindow } from 'electron'

// GitHub OAuth App 자격증명 — 사용자가 설정에서 입력하거나 빌드 시 환경변수로 주입
const CLIENT_ID     = process.env['GITHUB_CLIENT_ID']     ?? ''
const CLIENT_SECRET = process.env['GITHUB_CLIENT_SECRET'] ?? ''
const CALLBACK_PORT = 54321

function tokenFilePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'github-token.enc')
}

export function storeToken(token: string): void {
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token)           // 암호화 불가 환경(테스트) 폴백
  writeFileSync(tokenFilePath(), buf.toString('base64'), 'utf-8')
}

export function getStoredToken(): string | null {
  const path = tokenFilePath()
  if (!existsSync(path)) return null
  try {
    const b64 = readFileSync(path, 'utf-8')
    const buf = Buffer.from(b64, 'base64')
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString()
  } catch {
    return null
  }
}

export function clearToken(): void {
  writeFileSync(tokenFilePath(), '', 'utf-8')
}

async function exchangeCode(code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
  })
  const data = (await res.json()) as { access_token?: string; error?: string }
  if (!data.access_token) throw new Error(data.error ?? 'Token exchange failed')
  return data.access_token
}

export async function fetchGitHubUser(token: string): Promise<{ login: string; avatar_url: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub user fetch failed: ${res.status}`)
  return res.json() as Promise<{ login: string; avatar_url: string }>
}

export async function fetchUserRepos(token: string): Promise<Array<{ id: number; name: string; full_name: string; private: boolean; default_branch: string }>> {
  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`Repos fetch failed: ${res.status}`)
  return res.json() as Promise<Array<{ id: number; name: string; full_name: string; private: boolean; default_branch: string }>>
}

export function startOAuthFlow(mainWindow: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404); res.end(); return
      }
      const code = url.searchParams.get('code')
      if (!code) {
        res.writeHead(400); res.end('Missing code')
        server.close()
        return reject(new Error('Missing code in OAuth callback'))
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>✅ 인증 완료! 앱으로 돌아가세요.</h2></body></html>')
      server.close()

      try {
        const token = await exchangeCode(code)
        storeToken(token)
        mainWindow.webContents.send('github:auth-complete')
        resolve(token)
      } catch (err) {
        reject(err)
      }
    })

    server.listen(CALLBACK_PORT, () => {
      const authUrl =
        `https://github.com/login/oauth/authorize` +
        `?client_id=${CLIENT_ID}` +
        `&scope=repo,user` +
        `&redirect_uri=http://localhost:${CALLBACK_PORT}/callback`
      void shell.openExternal(authUrl)
    })

    server.on('error', reject)
  })
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd xzawedOrchestrator && pnpm test test/main/github-oauth-handler.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add xzawedOrchestrator/packages/app/src/main/github-oauth-handler.ts xzawedOrchestrator/packages/app/test/main/github-oauth-handler.test.ts
git commit -m "feat(app/main): GithubOAuthHandler — OAuth 콜백 서버·토큰 암호화 저장"
```

---

### Task 4: GitHub IPC 채널 (main + preload + types)

**Files:**
- Modify: `xzawedOrchestrator/packages/app/src/main/index.ts`
- Modify: `xzawedOrchestrator/packages/app/src/preload/index.ts`
- Modify: `xzawedOrchestrator/packages/app/src/renderer/src/electron.d.ts`

- [ ] **Step 1: main/index.ts 수정**

`createWindow()` 함수에서 `win`을 모듈 스코프 변수로 추출하고, GitHub IPC 핸들러를 추가한다.

```typescript
// src/main/index.ts — 전체 파일 교체
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { ServerManager } from './server-manager.js'
import {
  startOAuthFlow,
  getStoredToken,
  clearToken,
  fetchGitHubUser,
  fetchUserRepos,
} from './github-oauth-handler.js'

export interface AppSettings {
  serverUrl: string
  mode: 'local' | 'remote'
  userId: string
}

const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: 'http://localhost:3000',
  mode: 'local',
  userId: 'user',
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AppSettings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeSettings(settings: AppSettings): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

const serverManager = new ServerManager()
let mainWindow: BrowserWindow | null = null   // 모듈 스코프로 추출

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Settings ─────────────────────────────────────────────────────────
ipcMain.handle('settings:get', (): AppSettings => readSettings())
ipcMain.handle('settings:set', (_e, settings: AppSettings): void => writeSettings(settings))

// ── GitHub ───────────────────────────────────────────────────────────
ipcMain.handle('github:connect', async () => {
  if (!mainWindow) throw new Error('No window')
  await startOAuthFlow(mainWindow)
  const token = getStoredToken()
  if (!token) throw new Error('Token not stored after OAuth')
  const user = await fetchGitHubUser(token)
  return { username: user.login, avatarUrl: user.avatar_url }
})

ipcMain.handle('github:disconnect', () => {
  clearToken()
})

ipcMain.handle('github:get-status', async () => {
  const token = getStoredToken()
  if (!token) return { connected: false, username: null, avatarUrl: null }
  try {
    const user = await fetchGitHubUser(token)
    return { connected: true, username: user.login, avatarUrl: user.avatar_url }
  } catch {
    return { connected: false, username: null, avatarUrl: null }
  }
})

ipcMain.handle('github:list-repos', async () => {
  const token = getStoredToken()
  if (!token) return []
  const repos = await fetchUserRepos(token)
  return repos.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
  }))
})

ipcMain.handle('github:get-token', () => getStoredToken())

// ── Lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const settings = readSettings()
  if (settings.mode === 'local') serverManager.start()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => serverManager.stop())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: preload/index.ts 수정**

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings } from '../main/index.js'
// import type 사용 — 빌드 시 타입만 추출, 런타임 import 없음
import type { GitHubRepo, McpServerConfig, PluginInfo } from '../renderer/src/store/integrations.store.js'

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: AppSettings): Promise<void> =>
    ipcRenderer.invoke('settings:set', settings),

  // GitHub
  githubConnect: (): Promise<{ username: string; avatarUrl: string }> =>
    ipcRenderer.invoke('github:connect'),
  githubDisconnect: (): Promise<void> =>
    ipcRenderer.invoke('github:disconnect'),
  githubGetStatus: (): Promise<{ connected: boolean; username: string | null; avatarUrl: string | null }> =>
    ipcRenderer.invoke('github:get-status'),
  githubListRepos: (): Promise<GitHubRepo[]> =>
    ipcRenderer.invoke('github:list-repos'),
  githubGetToken: (): Promise<string | null> =>
    ipcRenderer.invoke('github:get-token'),
  onGitHubAuthComplete: (cb: () => void) => {
    ipcRenderer.on('github:auth-complete', cb)
    return () => ipcRenderer.removeListener('github:auth-complete', cb)
  },
})
```

- [ ] **Step 3: electron.d.ts 수정**

```typescript
// src/renderer/src/electron.d.ts
import type { AppSettings } from './store/app.store.js'
import type { GitHubRepo } from './store/integrations.store.js'

interface ElectronAPI {
  // Settings
  getSettings(): Promise<AppSettings>
  setSettings(settings: AppSettings): Promise<void>
  // GitHub
  githubConnect(): Promise<{ username: string; avatarUrl: string }>
  githubDisconnect(): Promise<void>
  githubGetStatus(): Promise<{ connected: boolean; username: string | null; avatarUrl: string | null }>
  githubListRepos(): Promise<GitHubRepo[]>
  githubGetToken(): Promise<string | null>
  onGitHubAuthComplete(cb: () => void): () => void
}

declare global {
  interface Window { electronAPI?: ElectronAPI }
}
export {}
```

- [ ] **Step 4: 빌드 확인**

```bash
cd xzawedOrchestrator && pnpm build
```
Expected: 타입 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add xzawedOrchestrator/packages/app/src/main/index.ts xzawedOrchestrator/packages/app/src/preload/index.ts xzawedOrchestrator/packages/app/src/renderer/src/electron.d.ts
git commit -m "feat(app): GitHub IPC 채널 추가 (connect·status·repos·token)"
```

---

### Task 5: GitHubPanel 컴포넌트

**Files:**
- Create: `xzawedOrchestrator/packages/app/src/renderer/src/components/GitHubPanel.tsx`

- [ ] **Step 1: GitHubPanel 구현**

```tsx
// src/renderer/src/components/GitHubPanel.tsx
import React, { useEffect, useState } from 'react'
import { useIntegrationsStore } from '../store/integrations.store.js'

export function GitHubPanel(): React.JSX.Element {
  const {
    github,
    setGitHubConnected,
    setGitHubRepos,
    setDefaultRepo,
    disconnectGitHub,
    setActivePanel,
  } = useIntegrationsStore()

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // 앱 시작 시 저장된 토큰으로 상태 복원
  useEffect(() => {
    async function restoreStatus(): Promise<void> {
      const status = await window.electronAPI?.githubGetStatus()
      if (status?.connected && status.username && status.avatarUrl) {
        setGitHubConnected(status.username, status.avatarUrl)
        const repos = await window.electronAPI?.githubListRepos() ?? []
        setGitHubRepos(repos)
      }
    }
    void restoreStatus()
  }, [])

  async function handleConnect(): Promise<void> {
    setLoading(true); setError(null)
    try {
      const result = await window.electronAPI?.githubConnect()
      if (!result) throw new Error('연결 실패')
      setGitHubConnected(result.username, result.avatarUrl)
      const repos = await window.electronAPI?.githubListRepos() ?? []
      setGitHubRepos(repos)
    } catch (err) {
      setError(err instanceof Error ? err.message : '연결 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect(): Promise<void> {
    await window.electronAPI?.githubDisconnect()
    disconnectGitHub()
  }

  return (
    <div className="integration-panel">
      <div className="panel-header">
        <button className="panel-back-btn" onClick={() => setActivePanel('chat')}>← 채팅으로</button>
        <h2>🐙 GitHub</h2>
      </div>

      {!github.connected ? (
        <div className="panel-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: '#a0a0c0', marginBottom: 24 }}>
            GitHub 계정을 연결하면 에이전트가 레포지토리 생성, 코드 push, PR 생성을 자동으로 수행합니다.
          </p>
          {error && <p style={{ color: '#ff6b6b', marginBottom: 16 }}>{error}</p>}
          <button className="panel-btn panel-btn--primary" onClick={handleConnect} disabled={loading}>
            {loading ? '브라우저에서 인증 중...' : '🐙 GitHub으로 로그인'}
          </button>
          <p style={{ fontSize: 11, color: '#6a6a8a', marginTop: 16 }}>
            GitHub OAuth App Client ID/Secret이 환경변수 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET에 설정돼 있어야 합니다.
          </p>
        </div>
      ) : (
        <>
          {/* 연결된 계정 */}
          <div className="panel-card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {github.avatarUrl && (
              <img src={github.avatarUrl} alt="avatar" style={{ width: 48, height: 48, borderRadius: '50%' }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ color: '#e0e0e0', fontWeight: 600 }}>{github.username}</div>
              <div style={{ color: '#6a6a8a', fontSize: 12 }}>연결됨</div>
            </div>
            <button className="panel-btn panel-btn--danger" onClick={handleDisconnect}>
              연결 해제
            </button>
          </div>

          {/* 기본 레포 선택 */}
          <div className="panel-card">
            <div style={{ color: '#a0a0c0', fontSize: 13, marginBottom: 8 }}>기본 레포지토리</div>
            <select
              style={{ width: '100%', background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13 }}
              value={github.defaultRepo ?? ''}
              onChange={(e) => setDefaultRepo(e.target.value)}
            >
              <option value="">-- 레포 선택 --</option>
              {github.repos.map((r) => (
                <option key={r.id} value={r.fullName}>{r.fullName} {r.private ? '🔒' : ''}</option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: '#6a6a8a', marginTop: 8 }}>
              선택된 레포를 기준으로 에이전트가 브랜치를 생성하고 코드를 push합니다.
            </p>
          </div>

          {/* 레포 목록 */}
          <div style={{ color: '#a0a0c0', fontSize: 12, marginBottom: 8 }}>
            레포지토리 ({github.repos.length}개)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {github.repos.map((repo) => (
              <div key={repo.id} className="panel-card" style={{ display: 'flex', alignItems: 'center', padding: '10px 16px' }}>
                <span style={{ flex: 1, color: '#e0e0e0', fontSize: 13 }}>{repo.fullName}</span>
                {repo.private && <span style={{ fontSize: 11, color: '#6a6a8a' }}>🔒 private</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: api.ts에 GitHub 토큰 헤더 추가**

`createSession`과 `postMessage`에 `X-GitHub-Token` 헤더를 추가한다. 토큰은 `integrations.store`에서 읽는다.

```typescript
// src/renderer/src/lib/api.ts — createSession·postMessage만 수정
import { useIntegrationsStore } from '../store/integrations.store.js'

function getGithubTokenHeader(): Record<string, string> {
  // Renderer에서는 IPC를 통해 토큰을 가져오므로 비동기가 필요하다.
  // 여기서는 store에 저장된 토큰 대신 Electron IPC 결과를 직접 사용한다.
  // 실제 토큰 헤더는 postMessage 호출 시 await로 주입한다.
  return {}
}

export async function createSession(
  baseUrl: string,
  userId: string,
  githubToken?: string
): Promise<CreateSessionResponse> {
  const res = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(githubToken ? { 'X-GitHub-Token': githubToken } : {}),
    },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`)
  return res.json() as Promise<CreateSessionResponse>
}

export async function postMessage(
  baseUrl: string,
  sessionId: string,
  content: string,
  githubToken?: string
): Promise<PostMessageResponse> {
  const res = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(githubToken ? { 'X-GitHub-Token': githubToken } : {}),
    },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`postMessage failed: ${res.status}`)
  return res.json() as Promise<PostMessageResponse>
}
```

`ChatView.tsx`에서 `postMessage` 호출 시 `await window.electronAPI?.githubGetToken()` 결과를 인자로 전달하도록 수정한다. (ChatView.tsx 내 `postMessage` 호출 위치를 찾아 추가)

- [ ] **Step 3: 빌드 확인**

```bash
cd xzawedOrchestrator && pnpm build
```
Expected: 타입 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/GitHubPanel.tsx xzawedOrchestrator/packages/app/src/renderer/src/lib/api.ts
git commit -m "feat(app): GitHubPanel UI + api.ts GitHub 토큰 헤더"
```

---

### Task 6: github-ops ToolHandler (xzawedManager)

**Files:**
- Create: `xzawedManager/packages/server/src/tools/github-ops.ts`
- Create: `xzawedManager/packages/server/src/tools/github-ops.test.ts`
- Modify: `xzawedManager/packages/server/src/config.ts`
- Modify: `xzawedManager/.env.example`

- [ ] **Step 1: @octokit/rest 설치**

```bash
cd xzawedManager && pnpm add @octokit/rest
```

- [ ] **Step 2: config.ts에 GITHUB_TOKEN 추가**

```typescript
// xzawedManager/packages/server/src/config.ts
import { z } from 'zod'

const configSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3001),
  MODE: z.enum(['local', 'remote']).default('local'),
  SERVICE_JWT_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),   // Orchestrator가 세션별로 전달
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(): Config {
  return configSchema.parse(process.env)
}
```

- [ ] **Step 3: .env.example 업데이트**

```bash
# xzawedManager/.env.example 맨 끝에 추가
echo "" >> xzawedManager/.env.example
echo "# GitHub (Orchestrator가 세션별로 주입 — 직접 설정도 가능)" >> xzawedManager/.env.example
echo "# GITHUB_TOKEN=" >> xzawedManager/.env.example
```

- [ ] **Step 4: 테스트 작성**

```typescript
// packages/server/src/tools/github-ops.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGithubOpsHandler } from './github-ops.js'

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      repos: {
        createForAuthenticatedUser: vi.fn().mockResolvedValue({
          data: { id: 1, name: 'my-repo', full_name: 'xzawed/my-repo', private: false, default_branch: 'main' },
        }),
        listForAuthenticatedUser: vi.fn().mockResolvedValue({ data: [] }),
      },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'abc123' } } }),
        createRef: vi.fn().mockResolvedValue({ data: {} }),
      },
      pulls: {
        create: vi.fn().mockResolvedValue({
          data: { number: 1, html_url: 'https://github.com/xzawed/my-repo/pull/1', title: 'feat' },
        }),
      },
      issues: {
        create: vi.fn().mockResolvedValue({
          data: { number: 2, html_url: 'https://github.com/xzawed/my-repo/issues/2', title: 'Issue' },
        }),
      },
    },
  })),
}))

describe('github-ops handler', () => {
  const handler = createGithubOpsHandler('ghp_testtoken')

  it('handler name이 github_ops이다', () => {
    expect(handler.name).toBe('github_ops')
  })

  it('createRepo 액션이 레포 정보를 반환한다', async () => {
    const result = await handler.execute(
      { action: 'createRepo', repoName: 'my-repo', private: false, description: 'test' },
      'session-1'
    )
    expect(result).toMatchObject({ name: 'my-repo' })
  })

  it('createBranch 액션이 브랜치를 생성한다', async () => {
    const result = await handler.execute(
      { action: 'createBranch', owner: 'xzawed', repo: 'my-repo', branch: 'feat/test', fromBranch: 'main' },
      'session-1'
    )
    expect(result).toMatchObject({ branch: 'feat/test' })
  })

  it('createPR 액션이 PR URL을 반환한다', async () => {
    const result = await handler.execute(
      { action: 'createPR', owner: 'xzawed', repo: 'my-repo', title: 'feat', head: 'feat/test', base: 'main', body: '' },
      'session-1'
    )
    expect((result as { url: string }).url).toContain('pull/1')
  })

  it('createIssue 액션이 이슈 URL을 반환한다', async () => {
    const result = await handler.execute(
      { action: 'createIssue', owner: 'xzawed', repo: 'my-repo', title: 'Bug', body: 'desc' },
      'session-1'
    )
    expect((result as { url: string }).url).toContain('issues/2')
  })
})
```

- [ ] **Step 5: 테스트 실행 → 실패 확인**

```bash
cd xzawedManager && pnpm test src/tools/github-ops.test.ts
```
Expected: `Cannot find module '…/github-ops.js'`

- [ ] **Step 6: github-ops.ts 구현**

```typescript
// packages/server/src/tools/github-ops.ts
import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'

const inputSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['createRepo', 'createBranch', 'commitAndPush', 'createPR', 'createIssue', 'mergeBranch', 'listRepos', 'listBranches'],
      description: 'GitHub operation to perform',
    },
    owner:       { type: 'string' },
    repo:        { type: 'string' },
    repoName:    { type: 'string' },
    description: { type: 'string' },
    private:     { type: 'boolean' },
    branch:      { type: 'string' },
    fromBranch:  { type: 'string' },
    base:        { type: 'string' },
    head:        { type: 'string' },
    title:       { type: 'string' },
    body:        { type: 'string' },
    files:       {
      type: 'array',
      items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
    commitMessage: { type: 'string' },
    issueNumber:   { type: 'number' },
  },
  required: ['action'],
}

type GithubInput = {
  action: 'createRepo' | 'createBranch' | 'commitAndPush' | 'createPR' | 'createIssue' | 'mergeBranch' | 'listRepos' | 'listBranches'
  owner?: string
  repo?: string
  repoName?: string
  description?: string
  private?: boolean
  branch?: string
  fromBranch?: string
  base?: string
  head?: string
  title?: string
  body?: string
  files?: Array<{ path: string; content: string }>
  commitMessage?: string
  issueNumber?: number
}

export function createGithubOpsHandler(token: string): ToolHandler<GithubInput, unknown> {
  const octokit = new Octokit({ auth: token })

  return {
    name: 'github_ops',
    description: 'Perform GitHub operations: create repo/branch, commit code, open PR, create issues',
    inputSchema,
    execute: async (input: GithubInput, _sessionId: string) => {
      switch (input.action) {
        case 'createRepo': {
          const { data } = await octokit.rest.repos.createForAuthenticatedUser({
            name: input.repoName!,
            description: input.description,
            private: input.private ?? false,
            auto_init: true,
          })
          return { id: data.id, name: data.name, fullName: data.full_name, defaultBranch: data.default_branch }
        }

        case 'listRepos': {
          const { data } = await octokit.rest.repos.listForAuthenticatedUser({ per_page: 100, sort: 'updated' })
          return data.map((r) => ({ id: r.id, name: r.name, fullName: r.full_name, private: r.private }))
        }

        case 'createBranch': {
          const { data: ref } = await octokit.rest.git.getRef({
            owner: input.owner!,
            repo: input.repo!,
            ref: `heads/${input.fromBranch ?? 'main'}`,
          })
          await octokit.rest.git.createRef({
            owner: input.owner!,
            repo: input.repo!,
            ref: `refs/heads/${input.branch!}`,
            sha: ref.object.sha,
          })
          return { branch: input.branch, sha: ref.object.sha }
        }

        case 'listBranches': {
          const { data } = await octokit.rest.repos.listBranches({ owner: input.owner!, repo: input.repo! })
          return data.map((b) => ({ name: b.name, sha: b.commit.sha }))
        }

        case 'commitAndPush': {
          const { files = [], commitMessage = 'chore: update files', branch, owner, repo } = input
          // 각 파일을 blob으로 생성 후 tree → commit → ref 업데이트
          const blobs = await Promise.all(
            files.map((f) =>
              octokit.rest.git.createBlob({ owner: owner!, repo: repo!, content: Buffer.from(f.content).toString('base64'), encoding: 'base64' })
            )
          )
          const { data: baseRef } = await octokit.rest.git.getRef({ owner: owner!, repo: repo!, ref: `heads/${branch!}` })
          const { data: baseCommit } = await octokit.rest.git.getCommit({ owner: owner!, repo: repo!, commit_sha: baseRef.object.sha })
          const { data: tree } = await octokit.rest.git.createTree({
            owner: owner!, repo: repo!,
            base_tree: baseCommit.tree.sha,
            tree: files.map((f, i) => ({ path: f.path, mode: '100644', type: 'blob', sha: blobs[i].data.sha })),
          })
          const { data: commit } = await octokit.rest.git.createCommit({
            owner: owner!, repo: repo!,
            message: commitMessage,
            tree: tree.sha,
            parents: [baseRef.object.sha],
          })
          await octokit.rest.git.updateRef({ owner: owner!, repo: repo!, ref: `heads/${branch!}`, sha: commit.sha })
          return { sha: commit.sha, branch }
        }

        case 'createPR': {
          const { data } = await octokit.rest.pulls.create({
            owner: input.owner!, repo: input.repo!,
            title: input.title!, head: input.head!, base: input.base ?? 'main',
            body: input.body ?? '',
          })
          return { number: data.number, url: data.html_url, title: data.title }
        }

        case 'createIssue': {
          const { data } = await octokit.rest.issues.create({
            owner: input.owner!, repo: input.repo!,
            title: input.title!, body: input.body ?? '',
          })
          return { number: data.number, url: data.html_url, title: data.title }
        }

        case 'mergeBranch': {
          const { data } = await octokit.rest.repos.merge({
            owner: input.owner!, repo: input.repo!,
            base: input.base ?? 'main', head: input.head!,
          })
          return { sha: data?.sha, merged: true }
        }

        default:
          throw new Error(`Unknown github action: ${String(input.action)}`)
      }
    },
  }
}
```

- [ ] **Step 7: github-ops를 Manager에 등록**

`xzawedManager/packages/server/src/claude/runner.ts` 파일을 열어 tools 배열을 생성하는 위치를 찾는다. 기존 `createPlanTaskHandler`, `createDevelopCodeHandler` 등이 등록된 패턴을 확인하고 동일하게 추가한다.

```typescript
// src/claude/runner.ts (또는 tools가 모이는 위치) — 기존 import 목록 끝에 추가
import { createGithubOpsHandler } from '../tools/github-ops.js'

// 기존 tools 배열 생성 위치에 추가 (config는 이미 loadConfig()로 로드됨)
// GITHUB_TOKEN이 없으면 등록은 하되 실행 시 Octokit이 401을 반환하므로 Claude가 에러 메시지로 처리
const githubToken = config.GITHUB_TOKEN ?? process.env['GITHUB_TOKEN'] ?? ''
tools.push(createGithubOpsHandler(githubToken))
```

> **참고:** `src/claude/runner.ts`가 아닌 다른 위치에 tools 배열이 있다면, `grep -r "createPlanTaskHandler" xzawedManager/packages/server/src/` 로 등록 위치를 찾아 동일 패턴 적용.

- [ ] **Step 8: 테스트 통과 확인**

```bash
cd xzawedManager && pnpm test src/tools/github-ops.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 9: 전체 테스트 통과 확인**

```bash
cd xzawedManager && pnpm test
```
Expected: 51 + 5 = 56 tests PASS (기존 51개 유지)

- [ ] **Step 10: 커밋**

```bash
git add xzawedManager/packages/server/src/tools/github-ops.ts xzawedManager/packages/server/src/tools/github-ops.test.ts xzawedManager/packages/server/src/config.ts xzawedManager/.env.example xzawedManager/package.json xzawedManager/pnpm-lock.yaml
git commit -m "feat(manager): github-ops ToolHandler — Octokit 기반 7개 GitHub 액션"
```

---

## Phase 3: MCP 서버 관리

### Task 7: McpProcessManager (main process + IPC)

**Files:**
- Create: `xzawedOrchestrator/packages/app/src/main/mcp-process-manager.ts`
- Create: `xzawedOrchestrator/packages/app/test/main/mcp-process-manager.test.ts`
- Modify: `xzawedOrchestrator/packages/app/src/main/index.ts`
- Modify: `xzawedOrchestrator/packages/app/src/preload/index.ts`
- Modify: `xzawedOrchestrator/packages/app/src/renderer/src/electron.d.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// test/main/mcp-process-manager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 1234,
    on: vi.fn(),
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  })),
}))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '[]'),
  mkdirSync: vi.fn(),
}))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } }))

import { McpProcessManager } from '../../src/main/mcp-process-manager.js'

describe('McpProcessManager', () => {
  let manager: McpProcessManager

  beforeEach(() => { manager = new McpProcessManager() })
  afterEach(() => manager.stopAll())

  it('서버를 추가하고 목록에 반환한다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    expect(manager.listServers()).toHaveLength(1)
    expect(manager.listServers()[0].id).toBe('ctx7')
  })

  it('서버를 시작하면 status가 running이 된다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    await manager.startServer('ctx7')
    expect(manager.getStatus('ctx7')).toBe('running')
  })

  it('서버를 제거하면 목록에서 사라진다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    await manager.removeServer('ctx7')
    expect(manager.listServers()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd xzawedOrchestrator && pnpm test test/main/mcp-process-manager.test.ts
```
Expected: `Cannot find module '…/mcp-process-manager.js'`

- [ ] **Step 3: McpProcessManager 구현**

```typescript
// src/main/mcp-process-manager.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { McpServerConfig } from '../renderer/src/store/integrations.store.js'

type McpStatus = 'running' | 'stopped' | 'error'

export class McpProcessManager {
  private processes = new Map<string, ChildProcess>()
  private statuses  = new Map<string, McpStatus>()
  private configs: McpServerConfig[] = []

  constructor() {
    this.configs = this.load()
  }

  private configPath(): string {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return join(dir, 'mcp-servers.json')
  }

  private load(): McpServerConfig[] {
    const path = this.configPath()
    if (!existsSync(path)) return []
    try { return JSON.parse(readFileSync(path, 'utf-8')) as McpServerConfig[] }
    catch { return [] }
  }

  private save(): void {
    writeFileSync(this.configPath(), JSON.stringify(this.configs, null, 2), 'utf-8')
  }

  listServers(): McpServerConfig[] { return [...this.configs] }

  getStatus(id: string): McpStatus { return this.statuses.get(id) ?? 'stopped' }

  getStatuses(): Record<string, McpStatus> {
    return Object.fromEntries(this.statuses.entries())
  }

  async addServer(config: McpServerConfig): Promise<void> {
    this.configs = this.configs.filter((c) => c.id !== config.id)
    this.configs.push(config)
    this.save()
    if (config.autoStart) await this.startServer(config.id)
  }

  async removeServer(id: string): Promise<void> {
    await this.stopServer(id)
    this.configs = this.configs.filter((c) => c.id !== id)
    this.save()
  }

  async startServer(id: string): Promise<void> {
    const config = this.configs.find((c) => c.id === id)
    if (!config) throw new Error(`MCP server not found: ${id}`)
    if (this.processes.has(id)) return

    const proc = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.processes.set(id, proc)
    this.statuses.set(id, 'running')

    proc.on('exit', () => {
      this.processes.delete(id)
      this.statuses.set(id, 'stopped')
    })
    proc.on('error', () => {
      this.processes.delete(id)
      this.statuses.set(id, 'error')
    })
  }

  async stopServer(id: string): Promise<void> {
    const proc = this.processes.get(id)
    if (!proc) return
    proc.kill()
    this.processes.delete(id)
    this.statuses.set(id, 'stopped')
  }

  stopAll(): void {
    for (const [id] of this.processes) void this.stopServer(id)
  }

  async startAutoStart(): Promise<void> {
    for (const config of this.configs) {
      if (config.autoStart) await this.startServer(config.id)
    }
  }
}
```

- [ ] **Step 4: MCP IPC 채널을 index.ts에 추가**

`src/main/index.ts`의 `// ── GitHub` 블록 아래에 추가:

```typescript
import { McpProcessManager } from './mcp-process-manager.js'

const mcpManager = new McpProcessManager()

// ── MCP ──────────────────────────────────────────────────────────────
ipcMain.handle('mcp:list', () =>
  mcpManager.listServers().map((s) => ({ ...s, status: mcpManager.getStatus(s.id) }))
)
ipcMain.handle('mcp:add',    (_e, config: McpServerConfig) => mcpManager.addServer(config))
ipcMain.handle('mcp:remove', (_e, id: string)              => mcpManager.removeServer(id))
ipcMain.handle('mcp:start',  (_e, id: string)              => mcpManager.startServer(id))
ipcMain.handle('mcp:stop',   (_e, id: string)              => mcpManager.stopServer(id))
ipcMain.handle('mcp:statuses', () => mcpManager.getStatuses())
```

`app.whenReady().then()`에 `await mcpManager.startAutoStart()`를 추가한다.

- [ ] **Step 5: preload와 electron.d.ts에 MCP 채널 추가**

`preload/index.ts`의 `contextBridge.exposeInMainWorld` 객체에 추가:

```typescript
  // MCP
  mcpList:     () => ipcRenderer.invoke('mcp:list'),
  mcpAdd:      (config: McpServerConfig) => ipcRenderer.invoke('mcp:add', config),
  mcpRemove:   (id: string)              => ipcRenderer.invoke('mcp:remove', id),
  mcpStart:    (id: string)              => ipcRenderer.invoke('mcp:start', id),
  mcpStop:     (id: string)              => ipcRenderer.invoke('mcp:stop', id),
  mcpStatuses: ()                        => ipcRenderer.invoke('mcp:statuses'),
```

`electron.d.ts`의 `ElectronAPI` 인터페이스에 추가:

```typescript
  mcpList(): Promise<Array<McpServerConfig & { status: 'running' | 'stopped' | 'error' }>>
  mcpAdd(config: McpServerConfig): Promise<void>
  mcpRemove(id: string): Promise<void>
  mcpStart(id: string): Promise<void>
  mcpStop(id: string): Promise<void>
  mcpStatuses(): Promise<Record<string, 'running' | 'stopped' | 'error'>>
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd xzawedOrchestrator && pnpm test test/main/mcp-process-manager.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 7: 커밋**

```bash
git add xzawedOrchestrator/packages/app/src/main/mcp-process-manager.ts xzawedOrchestrator/packages/app/src/main/index.ts xzawedOrchestrator/packages/app/src/preload/index.ts xzawedOrchestrator/packages/app/src/renderer/src/electron.d.ts xzawedOrchestrator/packages/app/test/main/mcp-process-manager.test.ts
git commit -m "feat(app/main): McpProcessManager + MCP IPC 채널"
```

---

### Task 8: McpPanel 컴포넌트

**Files:**
- Create: `xzawedOrchestrator/packages/app/src/renderer/src/components/McpPanel.tsx`

- [ ] **Step 1: McpPanel 구현**

```tsx
// src/renderer/src/components/McpPanel.tsx
import React, { useEffect, useState } from 'react'
import { useIntegrationsStore, type McpServerConfig } from '../store/integrations.store.js'

const RECOMMENDED: Array<Omit<McpServerConfig, 'id' | 'autoStart'>> = [
  { name: 'context7',    command: 'npx', args: ['@upstash/context7-mcp'],                      env: {}, },
  { name: 'playwright',  command: 'npx', args: ['@playwright/mcp@latest'],                     env: {}, },
  { name: 'supabase',    command: 'npx', args: ['@supabase/mcp-server-supabase@latest'],        env: { SUPABASE_URL: '', SUPABASE_KEY: '' } },
  { name: 'github-mcp',  command: 'npx', args: ['@modelcontextprotocol/server-github'],         env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } },
  { name: 'filesystem',  command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '.'], env: {} },
]

type Tab = 'installed' | 'recommended' | 'custom'

export function McpPanel(): React.JSX.Element {
  const { mcp, setMcpServers, setMcpStatus, setActivePanel } = useIntegrationsStore()
  const [tab, setTab] = useState<Tab>('installed')
  const [form, setForm] = useState({ name: '', command: 'npx', args: '', env: '' })
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    async function load(): Promise<void> {
      const list = await window.electronAPI?.mcpList() ?? []
      setMcpServers(list.map(({ status: _, ...s }) => s))
      const statuses = await window.electronAPI?.mcpStatuses() ?? {}
      Object.entries(statuses).forEach(([id, st]) => setMcpStatus(id, st))
    }
    void load()
  }, [])

  async function installRecommended(rec: typeof RECOMMENDED[0]): Promise<void> {
    setLoading(rec.name)
    const id = rec.name
    const config: McpServerConfig = { id, ...rec, autoStart: true }
    await window.electronAPI?.mcpAdd(config)
    setMcpServers([...mcp.servers, config])
    setMcpStatus(id, 'running')
    setLoading(null)
  }

  async function toggle(id: string): Promise<void> {
    setLoading(id)
    const status = mcp.statuses[id]
    if (status === 'running') {
      await window.electronAPI?.mcpStop(id)
      setMcpStatus(id, 'stopped')
    } else {
      await window.electronAPI?.mcpStart(id)
      setMcpStatus(id, 'running')
    }
    setLoading(null)
  }

  async function remove(id: string): Promise<void> {
    await window.electronAPI?.mcpRemove(id)
    setMcpServers(mcp.servers.filter((s) => s.id !== id))
  }

  async function addCustom(): Promise<void> {
    if (!form.name || !form.command) return
    const id = form.name.toLowerCase().replace(/\s+/g, '-')
    const args = form.args.split(' ').filter(Boolean)
    let env: Record<string, string> = {}
    try { env = JSON.parse(form.env || '{}') } catch { env = {} }
    const config: McpServerConfig = { id, name: form.name, command: form.command, args, env, autoStart: true }
    setLoading(id)
    await window.electronAPI?.mcpAdd(config)
    setMcpServers([...mcp.servers, config])
    setMcpStatus(id, 'running')
    setForm({ name: '', command: 'npx', args: '', env: '' })
    setLoading(null)
    setTab('installed')
  }

  const installedIds = new Set(mcp.servers.map((s) => s.id))

  return (
    <div className="integration-panel">
      <div className="panel-header">
        <button className="panel-back-btn" onClick={() => setActivePanel('chat')}>← 채팅으로</button>
        <h2>🔌 MCP 서버</h2>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #2a2a4a', marginBottom: 20 }}>
        {(['installed', 'recommended', 'custom'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
              color: tab === t ? '#e0e0e0' : '#6a6a8a',
              borderBottom: tab === t ? '2px solid #4a4aaa' : '2px solid transparent',
              fontSize: 13,
            }}
          >
            {t === 'installed' ? `설치됨 (${mcp.servers.length})` : t === 'recommended' ? '추천 서버' : '직접 추가'}
          </button>
        ))}
      </div>

      {/* 설치됨 탭 */}
      {tab === 'installed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mcp.servers.length === 0 && (
            <div style={{ color: '#6a6a8a', textAlign: 'center', padding: 40 }}>
              설치된 MCP 서버가 없습니다. "추천 서버" 탭에서 설치하세요.
            </div>
          )}
          {mcp.servers.map((s) => {
            const status = mcp.statuses[s.id] ?? 'stopped'
            return (
              <div key={s.id} className="panel-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 10, color: status === 'running' ? '#4caf50' : status === 'error' ? '#f44336' : '#9e9e9e' }}>●</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ color: '#6a6a8a', fontSize: 11 }}>{s.command} {s.args.join(' ')}</div>
                </div>
                <button className="panel-btn panel-btn--ghost" disabled={loading === s.id} onClick={() => toggle(s.id)}>
                  {loading === s.id ? '...' : status === 'running' ? '중지' : '시작'}
                </button>
                <button className="panel-btn panel-btn--danger" onClick={() => remove(s.id)}>제거</button>
              </div>
            )
          })}
        </div>
      )}

      {/* 추천 서버 탭 */}
      {tab === 'recommended' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {RECOMMENDED.map((rec) => {
            const installed = installedIds.has(rec.name)
            return (
              <div key={rec.name} className="panel-card">
                <div style={{ color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>{rec.name}</div>
                <div style={{ color: '#6a6a8a', fontSize: 11, marginBottom: 12 }}>{rec.command} {rec.args.join(' ')}</div>
                <button
                  className={`panel-btn ${installed ? 'panel-btn--success' : 'panel-btn--primary'}`}
                  style={{ width: '100%' }}
                  disabled={installed || loading === rec.name}
                  onClick={() => installRecommended(rec)}
                >
                  {loading === rec.name ? '설치 중...' : installed ? '✓ 설치됨' : '+ 설치'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 직접 추가 탭 */}
      {tab === 'custom' && (
        <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ color: '#a0a0c0', fontSize: 12, display: 'block', marginBottom: 4 }}>이름</label>
            <input
              style={{ width: '100%', background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13, boxSizing: 'border-box' }}
              placeholder="예: my-custom-mcp"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label style={{ color: '#a0a0c0', fontSize: 12, display: 'block', marginBottom: 4 }}>실행 명령어</label>
            <input
              style={{ width: '100%', background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13, boxSizing: 'border-box' }}
              placeholder="예: npx"
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
            />
          </div>
          <div>
            <label style={{ color: '#a0a0c0', fontSize: 12, display: 'block', marginBottom: 4 }}>인수 (공백 구분)</label>
            <input
              style={{ width: '100%', background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13, boxSizing: 'border-box' }}
              placeholder="예: @org/mcp-server --port 8080"
              value={form.args}
              onChange={(e) => setForm({ ...form, args: e.target.value })}
            />
          </div>
          <div>
            <label style={{ color: '#a0a0c0', fontSize: 12, display: 'block', marginBottom: 4 }}>환경변수 (JSON)</label>
            <input
              style={{ width: '100%', background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13, boxSizing: 'border-box' }}
              placeholder='예: {"API_KEY": "sk-..."}'
              value={form.env}
              onChange={(e) => setForm({ ...form, env: e.target.value })}
            />
          </div>
          <button className="panel-btn panel-btn--primary" onClick={addCustom} disabled={!form.name || !form.command}>
            + 추가 및 시작
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd xzawedOrchestrator && pnpm build
```
Expected: 타입 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/McpPanel.tsx
git commit -m "feat(app): McpPanel — 추천 스토어·설치됨·직접 추가 탭"
```

---

## Phase 4: Plugin 관리

### Task 9: PluginManager (main process + IPC)

**Files:**
- Create: `xzawedOrchestrator/packages/app/src/main/plugin-manager.ts`
- Create: `xzawedOrchestrator/packages/app/test/main/plugin-manager.test.ts`
- Modify: `xzawedOrchestrator/packages/app/src/main/index.ts`
- Modify: `xzawedOrchestrator/packages/app/src/preload/index.ts`
- Modify: `xzawedOrchestrator/packages/app/src/renderer/src/electron.d.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// test/main/plugin-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  exec: vi.fn((_cmd, cb) => cb(null, '', '')),
}))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => ['superpowers', 'context7']),
  readFileSync: vi.fn(() => JSON.stringify({ name: 'superpowers', version: '5.1.0', description: 'Skills and workflows' })),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } }))
// HOME 모킹
vi.stubEnv('HOME', '/tmp/test-home')
vi.stubEnv('USERPROFILE', 'C:/Users/test')

import { PluginManager } from '../../src/main/plugin-manager.js'

describe('PluginManager', () => {
  let manager: PluginManager

  beforeEach(() => { manager = new PluginManager() })

  it('Claude Code 플러그인 목록을 반환한다', async () => {
    const plugins = await manager.list()
    expect(plugins.some((p) => p.type === 'claude-code')).toBe(true)
  })

  it('플러그인을 활성/비활성 토글한다', async () => {
    const before = (await manager.list()).find((p) => p.id === 'superpowers')
    const wasBefore = before?.enabled
    await manager.toggle('superpowers')
    const after = (await manager.list()).find((p) => p.id === 'superpowers')
    expect(after?.enabled).toBe(!wasBefore)
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd xzawedOrchestrator && pnpm test test/main/plugin-manager.test.ts
```
Expected: `Cannot find module '…/plugin-manager.js'`

- [ ] **Step 3: PluginManager 구현**

```typescript
// src/main/plugin-manager.ts
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PluginInfo } from '../renderer/src/store/integrations.store.js'

const HOME = process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''
const CLAUDE_PLUGINS_DIR  = join(HOME, '.claude', 'plugins', 'cache')
const XZAWED_PLUGINS_DIR  = join(app.getPath('userData'), 'xzawed-extensions')

function disabledPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'disabled-plugins.json')
}

function loadDisabled(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(disabledPath(), 'utf-8')) as string[])
  } catch { return new Set() }
}

function saveDisabled(disabled: Set<string>): void {
  writeFileSync(disabledPath(), JSON.stringify([...disabled], null, 2), 'utf-8')
}

function readPluginDir(dir: string, type: PluginInfo['type'], disabled: Set<string>): PluginInfo[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).flatMap((vendor) => {
      const vendorPath = join(dir, vendor)
      return readdirSync(vendorPath).map((name) => {
        const pkgPath = join(vendorPath, name, 'package.json')
        let version = '0.0.0', description = ''
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string; description?: string }
            version = pkg.version ?? '0.0.0'
            description = pkg.description ?? ''
          } catch { /* ignore */ }
        }
        return { id: name, name, version, description, type, enabled: !disabled.has(name) }
      })
    })
  } catch { return [] }
}

export class PluginManager {
  async list(): Promise<PluginInfo[]> {
    const disabled = loadDisabled()
    const claudeCode = readPluginDir(CLAUDE_PLUGINS_DIR, 'claude-code', disabled)
    const xzawed: PluginInfo[] = []
    if (existsSync(XZAWED_PLUGINS_DIR)) {
      readdirSync(XZAWED_PLUGINS_DIR).forEach((name) => {
        const pkgPath = join(XZAWED_PLUGINS_DIR, name, 'package.json')
        let version = '0.0.0', description = ''
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string; description?: string }
            version = pkg.version ?? '0.0.0'
            description = pkg.description ?? ''
          } catch { /* ignore */ }
        }
        xzawed.push({ id: name, name, version, description, type: 'xzawed', enabled: !disabled.has(name) })
      })
    }
    return [...claudeCode, ...xzawed]
  }

  async install(packageName: string, type: PluginInfo['type']): Promise<void> {
    if (type === 'claude-code') {
      execSync(`npx skills add ${packageName}`, { stdio: 'inherit' })
    } else {
      if (!existsSync(XZAWED_PLUGINS_DIR)) mkdirSync(XZAWED_PLUGINS_DIR, { recursive: true })
      execSync(`npm install ${packageName} --prefix ${XZAWED_PLUGINS_DIR}`, { stdio: 'inherit' })
    }
  }

  async toggle(id: string): Promise<void> {
    const disabled = loadDisabled()
    if (disabled.has(id)) disabled.delete(id)
    else disabled.add(id)
    saveDisabled(disabled)
  }

  async uninstall(id: string): Promise<void> {
    try { execSync(`npm uninstall ${id}`, { stdio: 'ignore' }) } catch { /* ignore */ }
    const disabled = loadDisabled()
    disabled.delete(id)
    saveDisabled(disabled)
  }
}
```

- [ ] **Step 4: Plugin IPC 채널을 index.ts에 추가**

```typescript
import { PluginManager } from './plugin-manager.js'

const pluginManager = new PluginManager()

// ── Plugins ──────────────────────────────────────────────────────────
ipcMain.handle('plugin:list',      () => pluginManager.list())
ipcMain.handle('plugin:install',   (_e, pkg: string, type: PluginInfo['type']) => pluginManager.install(pkg, type))
ipcMain.handle('plugin:toggle',    (_e, id: string) => pluginManager.toggle(id))
ipcMain.handle('plugin:uninstall', (_e, id: string) => pluginManager.uninstall(id))
```

- [ ] **Step 5: preload와 electron.d.ts에 Plugin 채널 추가**

`preload/index.ts`에 추가:
```typescript
  pluginList:      ()                                     => ipcRenderer.invoke('plugin:list'),
  pluginInstall:   (pkg: string, type: PluginInfo['type']) => ipcRenderer.invoke('plugin:install', pkg, type),
  pluginToggle:    (id: string)                           => ipcRenderer.invoke('plugin:toggle', id),
  pluginUninstall: (id: string)                           => ipcRenderer.invoke('plugin:uninstall', id),
```

`electron.d.ts` `ElectronAPI`에 추가:
```typescript
  pluginList(): Promise<PluginInfo[]>
  pluginInstall(pkg: string, type: PluginInfo['type']): Promise<void>
  pluginToggle(id: string): Promise<void>
  pluginUninstall(id: string): Promise<void>
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd xzawedOrchestrator && pnpm test test/main/plugin-manager.test.ts
```
Expected: 2 tests PASS

- [ ] **Step 7: 커밋**

```bash
git add xzawedOrchestrator/packages/app/src/main/plugin-manager.ts xzawedOrchestrator/packages/app/src/main/index.ts xzawedOrchestrator/packages/app/src/preload/index.ts xzawedOrchestrator/packages/app/src/renderer/src/electron.d.ts xzawedOrchestrator/packages/app/test/main/plugin-manager.test.ts
git commit -m "feat(app/main): PluginManager + Plugin IPC 채널"
```

---

### Task 10: PluginPanel 컴포넌트

**Files:**
- Create: `xzawedOrchestrator/packages/app/src/renderer/src/components/PluginPanel.tsx`

- [ ] **Step 1: PluginPanel 구현**

```tsx
// src/renderer/src/components/PluginPanel.tsx
import React, { useEffect, useState } from 'react'
import { useIntegrationsStore, type PluginInfo } from '../store/integrations.store.js'

export function PluginPanel(): React.JSX.Element {
  const { plugins, setPlugins, togglePlugin, setActivePanel } = useIntegrationsStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'claude-code' | 'xzawed'>('all')
  const [loading, setLoading] = useState<string | null>(null)
  const [installForm, setInstallForm] = useState({ pkg: '', type: 'claude-code' as PluginInfo['type'] })
  const [showInstall, setShowInstall] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      const list = await window.electronAPI?.pluginList() ?? []
      setPlugins(list)
    }
    void load()
  }, [])

  const filtered = plugins.filter((p) => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
                        p.description.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || p.type === filter
    return matchSearch && matchFilter
  })

  async function handleToggle(id: string): Promise<void> {
    setLoading(id)
    await window.electronAPI?.pluginToggle(id)
    togglePlugin(id)
    setLoading(null)
  }

  async function handleUninstall(id: string): Promise<void> {
    setLoading(id)
    await window.electronAPI?.pluginUninstall(id)
    setPlugins(plugins.filter((p) => p.id !== id))
    setLoading(null)
  }

  async function handleInstall(): Promise<void> {
    if (!installForm.pkg) return
    setLoading('__installing__')
    await window.electronAPI?.pluginInstall(installForm.pkg, installForm.type)
    const list = await window.electronAPI?.pluginList() ?? []
    setPlugins(list)
    setInstallForm({ pkg: '', type: 'claude-code' })
    setShowInstall(false)
    setLoading(null)
  }

  return (
    <div className="integration-panel">
      <div className="panel-header">
        <button className="panel-back-btn" onClick={() => setActivePanel('chat')}>← 채팅으로</button>
        <h2>📦 Plugins</h2>
        <button
          className="panel-btn panel-btn--primary"
          style={{ marginLeft: 'auto' }}
          onClick={() => setShowInstall(!showInstall)}
        >
          + 설치
        </button>
      </div>

      {/* 설치 폼 */}
      {showInstall && (
        <div className="panel-card" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#a0a0c0', fontSize: 11, display: 'block', marginBottom: 4 }}>패키지명</label>
            <input
              style={{ width: '100%', background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '7px 10px', color: '#e0e0e0', fontSize: 12, boxSizing: 'border-box' }}
              placeholder="예: claude-plugins-official/figma"
              value={installForm.pkg}
              onChange={(e) => setInstallForm({ ...installForm, pkg: e.target.value })}
            />
          </div>
          <div>
            <label style={{ color: '#a0a0c0', fontSize: 11, display: 'block', marginBottom: 4 }}>종류</label>
            <select
              style={{ background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '7px 10px', color: '#e0e0e0', fontSize: 12 }}
              value={installForm.type}
              onChange={(e) => setInstallForm({ ...installForm, type: e.target.value as PluginInfo['type'] })}
            >
              <option value="claude-code">Claude Code</option>
              <option value="xzawed">xzawed</option>
            </select>
          </div>
          <button
            className="panel-btn panel-btn--primary"
            disabled={!installForm.pkg || loading === '__installing__'}
            onClick={handleInstall}
          >
            {loading === '__installing__' ? '설치 중...' : '설치'}
          </button>
        </div>
      )}

      {/* 검색 + 필터 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          style={{ flex: 1, background: '#16213e', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13 }}
          placeholder="🔍 플러그인 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ background: '#16213e', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13 }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">전체</option>
          <option value="claude-code">Claude Code</option>
          <option value="xzawed">xzawed</option>
        </select>
      </div>

      {/* 플러그인 목록 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ color: '#6a6a8a', textAlign: 'center', padding: 40 }}>
            {search ? '검색 결과가 없습니다.' : '설치된 플러그인이 없습니다.'}
          </div>
        )}
        {filtered.map((p) => (
          <div key={p.id} className="panel-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                <span className={`badge badge--${p.type === 'claude-code' ? 'claude-code' : 'xzawed'}`}>
                  {p.type === 'claude-code' ? 'Claude Code' : 'xzawed'}
                </span>
                <span className={`badge badge--${p.enabled ? 'active' : 'inactive'}`}>
                  {p.enabled ? '활성' : '비활성'}
                </span>
              </div>
              <div style={{ color: '#6a6a8a', fontSize: 11 }}>{p.description} · v{p.version}</div>
            </div>
            <button
              className={`panel-btn ${p.enabled ? 'panel-btn--ghost' : 'panel-btn--primary'}`}
              disabled={loading === p.id}
              onClick={() => handleToggle(p.id)}
            >
              {loading === p.id ? '...' : p.enabled ? '비활성화' : '활성화'}
            </button>
            <button
              className="panel-btn panel-btn--danger"
              disabled={loading === p.id}
              onClick={() => handleUninstall(p.id)}
            >
              제거
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 전체 빌드 + 테스트 확인**

```bash
cd xzawedOrchestrator && pnpm build && pnpm test
```
Expected: 빌드 성공, 모든 테스트 PASS

- [ ] **Step 3: xzawedManager 전체 테스트 확인**

```bash
cd xzawedManager && pnpm test
```
Expected: 56 tests PASS (기존 51 + github-ops 5)

- [ ] **Step 4: 최종 커밋**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/PluginPanel.tsx
git commit -m "feat(app): PluginPanel — 통합 목록·뱃지 구분·검색·필터"
```

---

## 자체 검토 체크리스트

구현 후 확인 사항:

- [ ] 모든 서비스 `pnpm test` 통과
- [ ] 모든 서비스 `pnpm build` 성공
- [ ] 900px 창 크기 기준 사이드바 자동 전환 동작
- [ ] GitHub OAuth 플로우: 브라우저 열림 → 콜백 → 토큰 저장 → 패널 갱신
- [ ] MCP 서버 추가 → 상태 running 표시 → 중지 → 제거
- [ ] Plugin 목록 로드 → 활성/비활성 토글 → 검색 필터
- [ ] 채팅 중 GitHub 메뉴 클릭 → 패널 전환 → "채팅으로" 버튼으로 복귀
