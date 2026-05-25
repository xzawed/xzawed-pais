import { create } from 'zustand'
import type { ServiceState } from '@xzawed/launcher-shared'

interface ServicesState {
  services: ServiceState[]
  logs: string[]
  setServices: (s: ServiceState[]) => void
  appendLog: (line: string) => void
  clearLogs: () => void
}

export const useServicesStore = create<ServicesState>((set) => ({
  services: [],
  logs: [],
  setServices: (services) => set({ services }),
  appendLog: (line) => set((s) => ({ logs: [...s.logs.slice(-199), line] })),
  clearLogs: () => set({ logs: [] }),
}))
