import { app, BrowserWindow, ipcMain, Menu } from 'electron'
// dev 모드에서 productName(xzawedOrchestrator)이 적용되지 않아 userData 경로가 어긋남
// electron-builder의 productName과 동기화하여 settings.json 경로를 일관되게 유지
if (!app.isPackaged) app.setName('xzawedOrchestrator')
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { ServerManager } from './server-manager.js'
import { McpProcessManager } from './mcp-process-manager.js'
import { PluginManager } from './plugin-manager.js'
import { focusExistingWindow } from './window-focus.js'
import {
  startOAuthFlow,
  getStoredToken,
  clearToken,
  fetchGitHubUser,
  fetchUserRepos,
} from './github-oauth-handler.js'
import {
  readToken,
  writeToken,
  readRefreshToken,
  writeRefreshToken,
  clearTokenFiles,
} from './token-storage-main.js'

export interface AppSettings {
  serverUrl: string
  mode: 'local' | 'remote'
  userId: string
  /** 전역 승인 게이트 모드 — 모든 단계 수동 승인(manual) vs 자동 통과(auto). 기본 manual. */
  gateMode: 'manual' | 'auto'
}

const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: process.env['SERVER_URL'] ?? 'http://localhost:3000',
  mode: 'local',
  userId: 'user',
  gateMode: 'manual',
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
let mcpManager: McpProcessManager
let pluginManager: PluginManager
let mainWindow: BrowserWindow | null = null

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
      sandbox: true,
    },
  })

  Menu.setApplicationMenu(null)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']) // NOSONAR — dev-only env set by electron-vite
  } else {
    const testRoute = process.env['ELECTRON_TEST_ROUTE']
    let testHash: string | undefined
    if (process.env['NODE_ENV'] === 'test') {
      testHash = testRoute === 'login' ? 'test-login'
        : testRoute === 'projects' ? 'test-projects'
        : 'test'
    }
    mainWindow.loadFile(
      join(__dirname, '../renderer/index.html'),
      testHash !== undefined ? { hash: testHash } : undefined
    ).catch((err: unknown) => console.error('[main] loadFile error:', err))
  }
}

// ── Settings ─────────────────────────────────────────────────────────
ipcMain.handle('settings:get', (): AppSettings => readSettings())
ipcMain.handle('settings:set', (_e, settings: AppSettings): void => {
  if (settings.serverUrl !== undefined && settings.serverUrl !== '') {
    let parsed: URL
    try {
      parsed = new URL(settings.serverUrl)
    } catch {
      throw new Error(`Invalid serverUrl: ${settings.serverUrl}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`serverUrl must use http or https scheme: ${settings.serverUrl}`)
    }
  }
  writeSettings(settings)
})

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

// ── Auth token (safeStorage) ─────────────────────────────────────────
// NOTE: token:get and refresh-token:get are intentionally absent — raw tokens
// must never be returned to the renderer. Use auth:restore for session recovery.
ipcMain.handle('token:set', (_e, token: string): void => writeToken(token))
ipcMain.handle('token:clear', (): void => clearTokenFiles())
ipcMain.handle('refresh-token:set', (_e, token: string): void => writeRefreshToken(token))

// ── Auth restore (proxy — token stays in main process) ────────────────
// auth:restore — main-process proxy: validates serverUrl (SSRF), reads stored tokens,
// calls /auth/me (or /auth/refresh on 401), stores new tokens, returns {user, accessToken}
// so the renderer never touches the raw token value.
ipcMain.handle('auth:restore', async (_e, serverUrl: string) => {
  // Validate serverUrl to prevent SSRF
  try {
    const u = new URL(serverUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { user: null }
  } catch { return { user: null } }
  const token = readToken()
  if (!token) return { user: null }
  try {
    const res = await fetch(`${serverUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const { user } = (await res.json()) as { user: { id: string; email: string; displayName?: string } }
      return { user, accessToken: token }
    }
    if (res.status === 401) {
      const refreshToken = readRefreshToken()
      if (!refreshToken) { clearTokenFiles(); return { user: null } }
      const refreshRes = await fetch(`${serverUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!refreshRes.ok) { clearTokenFiles(); return { user: null } }
      const { accessToken: newAt, refreshToken: newRt } =
        (await refreshRes.json()) as { accessToken: string; refreshToken: string }
      writeToken(newAt)
      writeRefreshToken(newRt)
      const meRes = await fetch(`${serverUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${newAt}` },
      })
      if (meRes.ok) {
        const { user } = (await meRes.json()) as { user: { id: string; email: string; displayName?: string } }
        return { user, accessToken: newAt }
      }
      clearTokenFiles()
      return { user: null }
    }
    clearTokenFiles()
    return { user: null }
  } catch {
    return { user: null }
  }
})

// ── MCP ──────────────────────────────────────────────────────────────
ipcMain.handle('mcp:list', () =>
  mcpManager.listServers().map(({ env: _env, ...s }) => ({ ...s, status: mcpManager.getStatus(s.id) }))
)
ipcMain.handle('mcp:add',      (_e, config) => mcpManager.addServer(config))
ipcMain.handle('mcp:remove',   (_e, id: string) => mcpManager.removeServer(id))
ipcMain.handle('mcp:start',    (_e, id: string) => mcpManager.startServer(id))
ipcMain.handle('mcp:stop',     (_e, id: string) => mcpManager.stopServer(id))
ipcMain.handle('mcp:statuses', () => mcpManager.getStatuses())

// ── Plugins ──────────────────────────────────────────────────────────
ipcMain.handle('plugin:list',      () => pluginManager.list())
ipcMain.handle('plugin:install',   (_e, pkg: string, type: string) => pluginManager.install(pkg, type as 'claude-code' | 'xzawed'))
ipcMain.handle('plugin:toggle',    (_e, id: string) => pluginManager.toggle(id))
ipcMain.handle('plugin:uninstall', (_e, id: string) => pluginManager.uninstall(id))

// ── Lifecycle ────────────────────────────────────────────────────────
// 단일 인스턴스 잠금.
//
// 두 번째 인스턴스는 창이 하나 더 뜨는 정도가 아니다. userData 의 JSON 세 개
// (settings.json · mcp-servers.json · disabled-plugins.json)를 전부 '기동 시 전체 로드 →
// 메모리 수정 → 전체 덮어쓰기'로 다루기 때문에, 두 인스턴스가 동시에 열려 있으면
// 나중에 저장한 쪽이 상대의 변경을 통째로 지운다. 여기에 더해 autoStart MCP 자식이
// 2벌 뜨고, MODE=local 이면 고정 포트 3000 으로 로컬 서버를 다시 spawn 한다 —
// 두 번째 서버는 EADDRINUSE 로 죽지만 ServerManager 는 spawn 실패만 듣기 때문에
// 아무도 그 사실을 모른다.
//
// `requestSingleInstanceLock()` 은 `whenReady()` **앞**에서 호출해야 한다. 창·서버 자식·
// MCP 자식이 만들어지기 전에 승패가 갈려야 하기 때문이다.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  // 진 인스턴스는 여기서 끝난다. 아래 어떤 핸들러도 등록하지 않는다.
  // `before-quit` 을 이 블록 밖에 두면 진 인스턴스도 그 핸들러를 달게 되고, 훗날
  // `ServerManager.stop()` 이 포트·PID 기반으로 바뀌는 순간 진 인스턴스가 이긴
  // 인스턴스의 서버를 죽이는 경로가 열린다.
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!focusExistingWindow(mainWindow) && app.isReady()) {
      // macOS 는 창을 모두 닫아도 앱이 살아 있다(window-all-closed 에서 quit 하지 않는다).
      // 그 상태에서 재실행하면 되살릴 창이 없으므로 새로 만든다. `isReady()` 가드는
      // 락 획득과 ready 사이에 두 번째 실행이 끼어드는 창을 막는다 — ready 전
      // BrowserWindow 생성은 throw 한다.
      createWindow()
    }
  })

  app.whenReady().then(async () => {
    mcpManager = new McpProcessManager()
    pluginManager = new PluginManager()
    const settings = readSettings()
    if (settings.mode === 'local') serverManager.start()
    createWindow()
    await mcpManager.startAutoStart()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((err: unknown) => {
    console.error('App initialization failed:', err)
    app.quit()
  })

  app.on('before-quit', () => {
    serverManager.stop()
    // `?.` 는 락과 무관한 이유로 여전히 필요하다 — whenReady 의 catch 경로에서는
    // mcpManager 가 대입되기 전에 quit 할 수 있다.
    mcpManager?.stopAll()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
