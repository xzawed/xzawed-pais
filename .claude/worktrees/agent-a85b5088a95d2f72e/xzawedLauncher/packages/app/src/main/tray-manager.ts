import { Tray, Menu, nativeImage, BrowserWindow, app, shell } from 'electron'
import path from 'node:path'
import type { ServiceState } from '@xzawed/launcher-shared'
import { buildDockerEnv } from './service-monitor.js'

let tray: Tray | null = null

function getIconPath(status: 'ok' | 'warn' | 'error'): string {
  const name = `tray-${status}.png`
  return path.join(process.resourcesPath ?? path.dirname(process.execPath), name)
}

export function createTray(win: BrowserWindow): Tray {
  tray = new Tray(nativeImage.createEmpty())
  updateTrayIcon([])
  tray.setToolTip('xzawed Launcher')
  tray.on('click', () => {
    win.show()
    win.focus()
  })
  updateTrayMenu(win)
  return tray
}

function resolveTrayStatus(hasError: boolean, hasWarn: boolean): 'error' | 'warn' | 'ok' {
  if (hasError) return 'error'
  if (hasWarn) return 'warn'
  return 'ok'
}

export function updateTrayIcon(states: ServiceState[]): void {
  if (!tray) return
  const hasError = states.some((s) => s.status === 'error')
  const hasWarn = states.some((s) => s.status === 'starting' || s.status === 'restarting')
  const status = resolveTrayStatus(hasError, hasWarn)
  try {
    tray.setImage(nativeImage.createFromPath(getIconPath(status)))
  } catch { /* icon file absent in dev */ }
}

function updateTrayMenu(win: BrowserWindow): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '🎯 Orchestrator 열기',
        click: () => {
          void shell.openExternal('http://localhost:3000') // NOSONAR
        }
      },
      { label: '📊 대시보드 표시', click: () => { win.show(); win.focus() } },
      { type: 'separator' },
      {
        label: '▶️ 전체 시작',
        click: () => {
          void import('./docker-manager.js').then(({ startAllServices }) =>
            startAllServices(() => {}, buildDockerEnv()).catch(() => {})
          )
        }
      },
      {
        label: '⏹ 전체 중지',
        click: () => {
          void import('./docker-manager.js').then(({ stopAllServices }) => stopAllServices().catch(() => {}))
        }
      },
      {
        label: '↺ 전체 재시작',
        click: () => {
          void import('./docker-manager.js').then(({ restartAllServices }) =>
            restartAllServices(() => {}, buildDockerEnv()).catch(() => {})
          )
        }
      },
      { type: 'separator' },
      {
        label: '🔄 업데이트 확인',
        click: () => {
          void import('./updater.js').then(({ checkForUpdates }) => checkForUpdates())
        }
      },
      { label: '⚙️ 설정', click: () => { win.show(); win.webContents.send('open-settings') } },
      { type: 'separator' },
      { label: '✕ 완전 종료', click: () => { app.quit() } },
    ])
  )
}
