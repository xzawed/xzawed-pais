export type WizardStep = 'welcome' | 'docker' | 'claude' | 'services' | 'complete'

export type ClaudeAuthMode = 'cli' | 'api'

export interface SetupConfig {
  claudeMode: ClaudeAuthMode
  githubToken?: string
  completedAt: string  // ISO 8601
}

export type DockerInstallStatus =
  | 'checking'
  | 'running'
  | 'installed-stopped'
  | 'not-installed'
  | 'installing'
  | 'error'

export type ClaudeDetectStatus =
  | 'checking'
  | 'logged-in'
  | 'not-logged-in'
  | 'not-installed'
  | 'installing'
  | 'error'
