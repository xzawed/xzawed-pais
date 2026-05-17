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
  githubGetToken: (): Promise<string | null> =>
    ipcRenderer.invoke('github:get-token'),
  onGitHubAuthComplete: (cb: () => void) => {
    ipcRenderer.on('github:auth-complete', cb)
    return (): void => {
      ipcRenderer.removeListener('github:auth-complete', cb)
    }
  },

  // MCP
  mcpList:     (): Promise<Array<{ id: string; name: string; command: string; args: string[]; env: Record<string, string>; autoStart: boolean; status: 'running' | 'stopped' | 'error' }>> => ipcRenderer.invoke('mcp:list'),
  mcpAdd:      (config: { id: string; name: string; command: string; args: string[]; env: Record<string, string>; autoStart: boolean }): Promise<void> => ipcRenderer.invoke('mcp:add', config),
  mcpRemove:   (id: string): Promise<void> => ipcRenderer.invoke('mcp:remove', id),
  mcpStart:    (id: string): Promise<void> => ipcRenderer.invoke('mcp:start', id),
  mcpStop:     (id: string): Promise<void> => ipcRenderer.invoke('mcp:stop', id),
  mcpStatuses: (): Promise<Record<string, 'running' | 'stopped' | 'error'>> => ipcRenderer.invoke('mcp:statuses'),
})
