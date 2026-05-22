import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { isSetupComplete, getSetupConfig, saveSetupConfig } from './setup-store.js'
import { checkDocker, startDockerDesktop, installDocker } from './docker-manager.js'
import { checkClaude, installClaude, openClaudeLogin, waitClaudeLogin, getClaudeEmail } from './claude-detector.js'
import { startMonitoring, stopMonitoring, registerServiceIpc } from './service-monitor.js'
import { createTray, updateTrayIcon } from './tray-manager.js'
import { initUpdater, checkForUpdates } from './updater.js'
import type { SetupConfig } from '@xzawed/launcher-shared'

let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 700,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  })

  win.once('ready-to-show', () => win?.show())

  win.on('close', (e) => {
    e.preventDefault()
    win?.hide()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']) // NOSONAR — dev-only env set by electron-vite
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html')).catch((err: unknown) => console.error('[main] loadFile error:', err))
  }

  return win
}

function encKeyPath(): string {
  return path.join(app.getPath('userData'), 'api-key.enc')
}

function registerIpc(w: BrowserWindow): void {
  // Setup
  ipcMain.handle('setup:is-complete', () => isSetupComplete())
  ipcMain.handle('setup:get-config', () => getSetupConfig())
  ipcMain.handle('setup:save-config', (_e, config: SetupConfig) => saveSetupConfig(config))

  // Docker
  ipcMain.handle('docker:check', () => checkDocker())
  ipcMain.handle('docker:install', () => installDocker())
  ipcMain.handle('docker:start-desktop', () => startDockerDesktop())

  // Claude
  ipcMain.handle('claude:check', () => checkClaude())
  ipcMain.handle('claude:get-email', () => getClaudeEmail())
  ipcMain.handle('claude:install', () => installClaude((line) => {
    if (!w.isDestroyed()) w.webContents.send('services:log', line)
  }))
  ipcMain.handle('claude:open-login', () => openClaudeLogin())
  ipcMain.handle('claude:wait-login', () => waitClaudeLogin())

  // Token (safeStorage)
  ipcMain.handle('token:get', () => {
    try {
      const raw = fs.readFileSync(encKeyPath())
      return safeStorage.decryptString(raw)
    } catch { return null }
  })
  ipcMain.handle('token:set', (_e, key: string) => {
    const enc = safeStorage.encryptString(key)
    const p = encKeyPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, enc)
  })
  ipcMain.handle('token:clear', () => {
    try { fs.unlinkSync(encKeyPath()) } catch { /* ignore */ }
  })

  // Tray
  ipcMain.handle('tray:minimize', () => w.hide())
  ipcMain.handle('orchestrator:open', () => shell.openExternal('http://localhost:3000')) // NOSONAR

  registerServiceIpc(w)
}

app.whenReady().then(() => {
  const w = createWindow()
  registerIpc(w)
  createTray(w)
  initUpdater(w)

  // Poll service statuses to update tray icon color
  setInterval(async () => {
    try {
      const { getServiceStatuses } = await import('./docker-manager.js')
      const states = await getServiceStatuses()
      updateTrayIcon(states)
    } catch { /* ignore */ }
  }, 5_000)

  startMonitoring(w)

  // Check for updates 5s after launch
  setTimeout(() => checkForUpdates(), 5_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopMonitoring()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
