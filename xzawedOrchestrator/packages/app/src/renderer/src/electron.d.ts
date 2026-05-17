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
  githubGetToken(): Promise<string | null>
  onGitHubAuthComplete(cb: () => void): () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
