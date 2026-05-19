import { contextBridge, ipcRenderer } from 'electron'
import type { ServiceState, SetupConfig, DockerInstallStatus, ClaudeDetectStatus } from '@xzawed/launcher-shared'

contextBridge.exposeInMainWorld('launcherAPI', {
  // Setup
  isSetupComplete: (): Promise<boolean> =>
    ipcRenderer.invoke('setup:is-complete'),
  getSetupConfig: (): Promise<SetupConfig | null> =>
    ipcRenderer.invoke('setup:get-config'),
  saveSetupConfig: (config: SetupConfig): Promise<void> =>
    ipcRenderer.invoke('setup:save-config', config),

  // Docker
  checkDocker: (): Promise<DockerInstallStatus> =>
    ipcRenderer.invoke('docker:check'),
  installDocker: (): Promise<void> =>
    ipcRenderer.invoke('docker:install'),
  startDockerDesktop: (): Promise<void> =>
    ipcRenderer.invoke('docker:start-desktop'),

  // Claude
  checkClaude: (): Promise<ClaudeDetectStatus> =>
    ipcRenderer.invoke('claude:check'),
  installClaude: (): Promise<void> =>
    ipcRenderer.invoke('claude:install'),
  openClaudeLogin: (): Promise<void> =>
    ipcRenderer.invoke('claude:open-login'),
  waitClaudeLogin: (): Promise<boolean> =>
    ipcRenderer.invoke('claude:wait-login'),

  // Services
  startAllServices: (): Promise<void> =>
    ipcRenderer.invoke('services:start-all'),
  stopAllServices: (): Promise<void> =>
    ipcRenderer.invoke('services:stop-all'),
  restartAllServices: (): Promise<void> =>
    ipcRenderer.invoke('services:restart-all'),
  restartService: (name: string): Promise<void> =>
    ipcRenderer.invoke('services:restart', name),
  stopService: (name: string): Promise<void> =>
    ipcRenderer.invoke('services:stop', name),
  getServicesStatus: (): Promise<ServiceState[]> =>
    ipcRenderer.invoke('services:get-status'),
  onServicesUpdate: (cb: (states: ServiceState[]) => void) => {
    ipcRenderer.on('services:update', (_e, states) => cb(states))
    return (): void => { ipcRenderer.removeAllListeners('services:update') }
  },
  onLogLine: (cb: (line: string) => void) => {
    ipcRenderer.on('services:log', (_e, line) => cb(line))
    return (): void => { ipcRenderer.removeAllListeners('services:log') }
  },

  // Updater
  checkUpdate: (): Promise<void> =>
    ipcRenderer.invoke('updater:check'),
  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke('updater:install'),
  onUpdateAvailable: (cb: (info: { version: string; releaseNotes: string }) => void) => {
    ipcRenderer.on('updater:available', (_e, info) => cb(info))
    return (): void => { ipcRenderer.removeAllListeners('updater:available') }
  },

  // Token (safeStorage)
  tokenGet: (): Promise<string | null> =>
    ipcRenderer.invoke('token:get'),
  tokenSet: (key: string): Promise<void> =>
    ipcRenderer.invoke('token:set', key),
  tokenClear: (): Promise<void> =>
    ipcRenderer.invoke('token:clear'),

  // Tray
  minimizeToTray: (): Promise<void> =>
    ipcRenderer.invoke('tray:minimize'),
  openOrchestrator: (): Promise<void> =>
    ipcRenderer.invoke('orchestrator:open'),
})
