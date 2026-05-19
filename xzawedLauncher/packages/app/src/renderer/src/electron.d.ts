import type { ServiceState, SetupConfig, DockerInstallStatus, ClaudeDetectStatus } from '@xzawed/launcher-shared'

interface LauncherAPI {
  isSetupComplete(): Promise<boolean>
  getSetupConfig(): Promise<SetupConfig | null>
  saveSetupConfig(config: SetupConfig): Promise<void>
  checkDocker(): Promise<DockerInstallStatus>
  installDocker(): Promise<void>
  startDockerDesktop(): Promise<void>
  checkClaude(): Promise<ClaudeDetectStatus>
  installClaude(): Promise<void>
  openClaudeLogin(): Promise<void>
  waitClaudeLogin(): Promise<boolean>
  startAllServices(): Promise<void>
  stopAllServices(): Promise<void>
  restartAllServices(): Promise<void>
  restartService(name: string): Promise<void>
  stopService(name: string): Promise<void>
  getServicesStatus(): Promise<ServiceState[]>
  onServicesUpdate(cb: (states: ServiceState[]) => void): () => void
  onLogLine(cb: (line: string) => void): () => void
  checkUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateAvailable(cb: (info: { version: string; releaseNotes: string }) => void): () => void
  tokenGet(): Promise<string | null>
  tokenSet(key: string): Promise<void>
  tokenClear(): Promise<void>
  minimizeToTray(): Promise<void>
  openOrchestrator(): Promise<void>
}

declare global {
  interface Window { launcherAPI?: LauncherAPI }
  var launcherAPI: LauncherAPI | undefined
}
export {}
