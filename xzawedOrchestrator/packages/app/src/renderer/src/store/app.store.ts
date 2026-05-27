import { create } from 'zustand'
import i18n from '../lib/i18n.js'
import type { Locale } from '../lib/detect-locale.js'

export interface AppSettings {
  serverUrl: string
  mode: 'local' | 'remote'
  userId: string
}

interface AppState {
  settings: AppSettings
  serverStatus: 'unknown' | 'running' | 'stopped'
  showSettings: boolean
  locale: Locale
  updateSettings: (s: Partial<AppSettings>) => void
  setServerStatus: (s: 'unknown' | 'running' | 'stopped') => void
  toggleSettings: () => void
  setLocale: (locale: Locale) => void
}

export const useAppStore = create<AppState>((set) => ({
  settings: {
    // NOTE: main/index.ts DEFAULT_SETTINGS와 동기화 필요 (기본값 변경 시 두 곳 모두 수정)
    serverUrl: 'http://localhost:3000',
    mode: 'local',
    userId: 'user',
  },
  serverStatus: 'unknown',
  showSettings: false,
  locale: 'ko',
  updateSettings: (s) =>
    set((state) => ({ settings: { ...state.settings, ...s } })),
  setServerStatus: (serverStatus) => set({ serverStatus }),
  toggleSettings: () => set((state) => ({ showSettings: !state.showSettings })),
  setLocale: (locale) => {
    void i18n.changeLanguage(locale)
    localStorage.setItem('locale', locale)
    set({ locale })
  },
}))
