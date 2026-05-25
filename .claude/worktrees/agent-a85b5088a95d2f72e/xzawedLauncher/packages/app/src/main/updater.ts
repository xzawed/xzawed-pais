import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

type ReleaseNote = string | { note?: string }

function resolveReleaseNotes(releaseNotes: string | ReleaseNote[] | null | undefined): string {
  if (typeof releaseNotes === 'string') return releaseNotes
  if (Array.isArray(releaseNotes)) {
    return releaseNotes.map((n) => (typeof n === 'string' ? n : n.note ?? '')).join('\n')
  }
  return ''
}

export function initUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    const notes = resolveReleaseNotes(info.releaseNotes)
    if (!win.isDestroyed()) {
      win.webContents.send('updater:available', { version: info.version, releaseNotes: notes })
    }
  })

  ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates())
  ipcMain.handle('updater:install', async () => {
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall()
  })
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch(() => {})
}
