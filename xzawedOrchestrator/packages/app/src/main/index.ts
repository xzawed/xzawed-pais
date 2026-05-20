import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { ServerManager } from './server-manager.js'
import { McpProcessManager } from './mcp-process-manager.js'
import { PluginManager } from './plugin-manager.js'
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
  serverUrl: process.env['SERVER_URL'] ?? 'http://localhost:3000',
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
const mcpManager = new McpProcessManager()
const pluginManager = new PluginManager()
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
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']) // NOSONAR — dev-only env set by electron-vite
  } else {
    const isTest = process.env['NODE_ENV'] === 'test'
    void mainWindow.loadFile(
      join(__dirname, '../renderer/index.html'),
      isTest ? { hash: 'test' } : undefined
    )
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

// ── Auth token (safeStorage) ─────────────────────────────────────────
const TOKEN_FILE = 'auth-token.enc'
const REFRESH_TOKEN_FILE = 'refresh-token.enc'

function getTokenPath(): string {
  return join(app.getPath('userData'), TOKEN_FILE)
}

function getRefreshTokenPath(): string {
  return join(app.getPath('userData'), REFRESH_TOKEN_FILE)
}

function readEncryptedToken(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  try {
    const encrypted = readFileSync(filePath)
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(encrypted)
      : encrypted.toString('utf-8')
  } catch {
    return null
  }
}

function writeEncryptedToken(filePath: string, token: string): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, 'utf-8')
  writeFileSync(filePath, data)
}

function deleteFileIfExists(filePath: string): void {
  if (existsSync(filePath)) {
    try { unlinkSync(filePath) } catch { /* ignore */ }
  }
}

ipcMain.handle('token:get', (): string | null => readEncryptedToken(getTokenPath()))

ipcMain.handle('token:set', (_e, token: string): void => writeEncryptedToken(getTokenPath(), token))

ipcMain.handle('token:clear', (): void => {
  deleteFileIfExists(getTokenPath())
  deleteFileIfExists(getRefreshTokenPath())
})

ipcMain.handle('refresh-token:get', (): string | null => readEncryptedToken(getRefreshTokenPath()))

ipcMain.handle('refresh-token:set', (_e, token: string): void => writeEncryptedToken(getRefreshTokenPath(), token))

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
app.whenReady().then(async () => {
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
  mcpManager.stopAll()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
