import { create } from 'zustand'

export interface AppSettings {
  serverUrl: string
  mode: 'local' | 'remote'
  userId: string
}

interface AppState {
  settings: AppSettings
  serverStatus: 'unknown' | 'running' | 'stopped'
  showSettings: boolean
  updateSettings: (s: Partial<AppSettings>) => void
  setServerStatus: (s: 'unknown' | 'running' | 'stopped') => void
  toggleSettings: () => void
}

export const useAppStore = create<AppState>((set) => ({
  settings: {
    serverUrl: 'http://localhost:3000',
    mode: 'local',
    userId: 'user',
  },
  serverStatus: 'unknown',
  showSettings: false,
  updateSettings: (s) =>
    set((state) => ({ settings: { ...state.settings, ...s } })),
  setServerStatus: (serverStatus) => set({ serverStatus }),
  toggleSettings: () => set((state) => ({ showSettings: !state.showSettings })),
}))
