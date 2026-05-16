import type { AppSettings } from './store/app.store.js'

interface ElectronAPI {
  getSettings(): Promise<AppSettings>
  setSettings(settings: AppSettings): Promise<void>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
