import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface GitHubRepo {
  id: number
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  autoStart: boolean
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  type: 'claude-code' | 'xzawed'
  enabled: boolean
}

export type ActivePanel = 'chat' | 'github' | 'mcp' | 'plugins'
export type SidebarMode = 'compact' | 'expanded' | 'auto'

interface IntegrationsState {
  github: {
    connected: boolean
    username: string | null
    avatarUrl: string | null
    defaultRepo: string | null
    repos: GitHubRepo[]
  }
  mcp: {
    servers: McpServerConfig[]
    statuses: Record<string, 'running' | 'stopped' | 'error'>
  }
  plugins: PluginInfo[]
  activePanel: ActivePanel
  sidebarMode: SidebarMode
  setGitHubConnected: (username: string, avatarUrl: string) => void
  setGitHubRepos: (repos: GitHubRepo[]) => void
  setDefaultRepo: (repo: string) => void
  disconnectGitHub: () => void
  setMcpServers: (servers: McpServerConfig[]) => void
  setMcpStatus: (id: string, status: 'running' | 'stopped' | 'error') => void
  setPlugins: (plugins: PluginInfo[]) => void
  togglePlugin: (id: string) => void
  setActivePanel: (panel: ActivePanel) => void
  setSidebarMode: (mode: SidebarMode) => void
}

export const useIntegrationsStore = create<IntegrationsState>()(
  persist(
    (set) => ({
      github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] },
      mcp: { servers: [], statuses: {} },
      plugins: [],
      activePanel: 'chat',
      sidebarMode: 'auto',
      setGitHubConnected: (username, avatarUrl) =>
        set((s) => ({ github: { ...s.github, connected: true, username, avatarUrl } })),
      setGitHubRepos: (repos) =>
        set((s) => ({ github: { ...s.github, repos } })),
      setDefaultRepo: (repo) =>
        set((s) => ({ github: { ...s.github, defaultRepo: repo } })),
      disconnectGitHub: () =>
        set(() => ({ github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] } })),
      setMcpServers: (servers) =>
        set((s) => ({ mcp: { ...s.mcp, servers } })),
      setMcpStatus: (id, status) =>
        set((s) => ({ mcp: { ...s.mcp, statuses: { ...s.mcp.statuses, [id]: status } } })),
      setPlugins: (plugins) => set({ plugins }),
      togglePlugin: (id) =>
        set((s) => ({ plugins: s.plugins.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p) })),
      setActivePanel: (panel) => set({ activePanel: panel }),
      setSidebarMode: (mode) => set({ sidebarMode: mode }),
    }),
    {
      name: 'integrations-store',
      partialize: (s) => ({ sidebarMode: s.sidebarMode, github: { defaultRepo: s.github.defaultRepo } }),
    }
  )
)
