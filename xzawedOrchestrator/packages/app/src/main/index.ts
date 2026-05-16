import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { ServerManager } from './server-manager.js'

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

function createWindow(): void {
  const win = new BrowserWindow({
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
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('settings:get', (): AppSettings => {
  return readSettings()
})

ipcMain.handle('settings:set', (_event, settings: AppSettings): void => {
  writeSettings(settings)
})

app.whenReady().then(() => {
  const settings = readSettings()
  if (settings.mode === 'local') {
    serverManager.start()
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  serverManager.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
