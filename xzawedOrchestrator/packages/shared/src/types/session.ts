export type SessionState =
  | 'active'
  | 'waiting_manager'
  | 'waiting_user'
  | 'completed'
  | 'error'

export type ClaudeMode = 'cli' | 'api' | 'remote'

export interface Session {
  id: string
  userId: string
  state: SessionState
  claudeMode: ClaudeMode
  createdAt: number
  updatedAt: number
}
