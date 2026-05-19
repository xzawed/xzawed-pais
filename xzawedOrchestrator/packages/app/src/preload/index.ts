import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings } from '../main/index.js'

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: AppSettings): Promise<void> =>
    ipcRenderer.invoke('settings:set', settings),

  // GitHub
  githubConnect: (): Promise<{ username: string; avatarUrl: string }> =>
    ipcRenderer.invoke('github:connect'),
  githubDisconnect: (): Promise<void> =>
    ipcRenderer.invoke('github:disconnect'),
  githubGetStatus: (): Promise<{
    connected: boolean
    username: string | null
    avatarUrl: string | null
  }> => ipcRenderer.invoke('github:get-status'),
  githubListRepos: (): Promise<
    Array<{ id: number; name: string; fullName: string; private: boolean; defaultBranch: string }>
  > => ipcRenderer.invoke('github:list-repos'),
  onGitHubAuthComplete: (cb: () => void) => {
    ipcRenderer.on('github:auth-complete', cb)
    return (): void => {
      ipcRenderer.removeListener('github:auth-complete', cb)
    }
  },

  // MCP
  mcpList:     (): Promise<Array<{ id: string; name: string; command: string; args: string[]; autoStart: boolean; status: 'running' | 'stopped' | 'error' }>> => ipcRenderer.invoke('mcp:list'),
  mcpAdd:      (config: { id: string; name: string; command: string; args: string[]; env: Record<string, string>; autoStart: boolean }): Promise<void> => ipcRenderer.invoke('mcp:add', config),
  mcpRemove:   (id: string): Promise<void> => ipcRenderer.invoke('mcp:remove', id),
  mcpStart:    (id: string): Promise<void> => ipcRenderer.invoke('mcp:start', id),
  mcpStop:     (id: string): Promise<void> => ipcRenderer.invoke('mcp:stop', id),
  mcpStatuses: (): Promise<Record<string, 'running' | 'stopped' | 'error'>> => ipcRenderer.invoke('mcp:statuses'),

  // Plugins
  pluginList:      (): Promise<Array<{ id: string; name: string; version: string; description: string; type: 'claude-code' | 'xzawed'; enabled: boolean }>> => ipcRenderer.invoke('plugin:list'),
  pluginInstall:   (pkg: string, type: 'claude-code' | 'xzawed'): Promise<void> => ipcRenderer.invoke('plugin:install', pkg, type),
  pluginToggle:    (id: string): Promise<void> => ipcRenderer.invoke('plugin:toggle', id),
  pluginUninstall: (id: string): Promise<void> => ipcRenderer.invoke('plugin:uninstall', id),

  // Auth token (safeStorage)
  tokenGet:   (): Promise<string | null> => ipcRenderer.invoke('token:get'),
  tokenSet:   (token: string): Promise<void> => ipcRenderer.invoke('token:set', token),
  tokenClear: (): Promise<void> => ipcRenderer.invoke('token:clear'),
})
