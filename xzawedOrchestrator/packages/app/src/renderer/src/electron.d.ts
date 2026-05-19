import type { AppSettings } from './store/app.store.js'
import type { GitHubRepo } from './store/integrations.store.js'

interface ElectronAPI {
  // Settings
  getSettings(): Promise<AppSettings>
  setSettings(settings: AppSettings): Promise<void>
  // GitHub
  githubConnect(): Promise<{ username: string; avatarUrl: string }>
  githubDisconnect(): Promise<void>
  githubGetStatus(): Promise<{
    connected: boolean
    username: string | null
    avatarUrl: string | null
  }>
  githubListRepos(): Promise<GitHubRepo[]>
  onGitHubAuthComplete(cb: () => void): () => void
  // MCP
  mcpList(): Promise<Array<{ id: string; name: string; command: string; args: string[]; autoStart: boolean; status: 'running' | 'stopped' | 'error' }>>
  mcpAdd(config: { id: string; name: string; command: string; args: string[]; env: Record<string, string>; autoStart: boolean }): Promise<void>
  mcpRemove(id: string): Promise<void>
  mcpStart(id: string): Promise<void>
  mcpStop(id: string): Promise<void>
  mcpStatuses(): Promise<Record<string, 'running' | 'stopped' | 'error'>>
  // Plugins
  pluginList(): Promise<Array<{ id: string; name: string; version: string; description: string; type: 'claude-code' | 'xzawed'; enabled: boolean }>>
  pluginInstall(pkg: string, type: 'claude-code' | 'xzawed'): Promise<void>
  pluginToggle(id: string): Promise<void>
  pluginUninstall(id: string): Promise<void>
  // Auth token
  tokenGet(): Promise<string | null>
  tokenSet(token: string): Promise<void>
  tokenClear(): Promise<void>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
  // eslint-disable-next-line no-var
  var electronAPI: ElectronAPI | undefined
}

export {}
