import { BrowserWindow, ipcMain, safeStorage, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { getServiceStatuses } from './docker-manager.js'
import { getSetupConfig } from './setup-store.js'

/**
 * compose가 `${POSTGRES_PASSWORD:?}`로 요구하는 값. 없으면 컨테이너가 뜨기도 전에
 * 보간 단계에서 죽는다.
 *
 * 최초 1회 생성해 userData에 보관한다 — postgres 볼륨이 재시작을 넘어 유지되므로
 * 값이 바뀌면 기존 데이터에 인증이 깨진다. 저장소에 하드코딩하지 않는 이유이기도 하다.
 * compose의 postgres는 포트를 노출하지 않아 이 값은 compose 네트워크 밖에서 쓰이지 않는다.
 */
export function getOrCreateDbPassword(): string {
  const p = path.join(app.getPath('userData'), 'db-password')
  try {
    const existing = fs.readFileSync(p, 'utf-8').trim()
    if (existing) return existing
  } catch { /* 최초 실행 */ }
  const pw = randomBytes(24).toString('base64url')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, pw, { mode: 0o600 })
  return pw
}

export function buildDockerEnv(): Record<string, string> {
  const cfg = getSetupConfig()
  if (!cfg) return {}
  const env: Record<string, string> = {
    CLAUDE_MODE: cfg.claudeMode,
    POSTGRES_PASSWORD: getOrCreateDbPassword(),
  }
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
