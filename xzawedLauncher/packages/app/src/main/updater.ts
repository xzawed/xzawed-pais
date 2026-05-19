import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

export function initUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    const notes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note ?? '')).join('\n')
        : ''
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
