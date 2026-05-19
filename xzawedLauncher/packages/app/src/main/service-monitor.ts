import { BrowserWindow, ipcMain, safeStorage, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getServiceStatuses } from './docker-manager.js'
import { getSetupConfig } from './setup-store.js'

function buildDockerEnv(): Record<string, string> {
  const cfg = getSetupConfig()
  if (!cfg) return {}
  const env: Record<string, string> = { CLAUDE_MODE: cfg.claudeMode }
  if (cfg.claudeMode !== 'cli') {
    try {
      const encPath = path.join(app.getPath('userData'), 'api-key.enc')
      const raw = fs.readFileSync(encPath)
      const key = safeStorage.decryptString(raw)
      if (key) env['ANTHROPIC_API_KEY'] = key
    } catch { /* no key stored */ }
  }
  return env
}

let interval: ReturnType<typeof setInterval> | null = null

export function startMonitoring(win: BrowserWindow): void {
  if (interval) return
  interval = setInterval(async () => {
    try {
      const states = await getServiceStatuses()
      if (!win.isDestroyed()) {
        win.webContents.send('services:update', states)
      }
    } catch { /* ignore */ }
  }, 3_000)
}

export function stopMonitoring(): void {
  if (interval) { clearInterval(interval); interval = null }
}

export function registerServiceIpc(win: BrowserWindow): void {
  ipcMain.handle('services:get-status', () => getServiceStatuses())
  ipcMain.handle('services:start-all', async () => {
    const { startAllServices } = await import('./docker-manager.js')
    await startAllServices((line) => {
      if (!win.isDestroyed()) win.webContents.send('services:log', line)
    }, buildDockerEnv())
  })
  ipcMain.handle('services:stop-all', async () => {
    const { stopAllServices } = await import('./docker-manager.js')
    await stopAllServices()
  })
  ipcMain.handle('services:restart-all', async () => {
    const { restartAllServices } = await import('./docker-manager.js')
    await restartAllServices((line) => {
      if (!win.isDestroyed()) win.webContents.send('services:log', line)
    }, buildDockerEnv())
  })
  ipcMain.handle('services:restart', async (_e, name: string) => {
    const { restartService } = await import('./docker-manager.js')
    return restartService(name)
  })
  ipcMain.handle('services:stop', async (_e, name: string) => {
    const { stopService } = await import('./docker-manager.js')
    return stopService(name)
  })
}
