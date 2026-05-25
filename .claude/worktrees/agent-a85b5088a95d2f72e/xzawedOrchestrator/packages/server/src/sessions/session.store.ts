import type { Session, SessionState, ClaudeMode } from '@xzawed/shared'
import { createSession } from './session.js'

export interface SessionStore {
  create(userId: string, projectId: string | null, mode: ClaudeMode): Promise<Session>
  findById(id: string): Promise<Session | undefined>
  updateState(id: string, state: SessionState): Promise<void>
  updateClaudeSessionId(id: string, claudeSessionId: string): Promise<void>
  delete(id: string): Promise<void>
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>()
  private readonly claudeSessionIds = new Map<string, string>()

  async create(userId: string, _projectId: string | null, claudeMode: ClaudeMode): Promise<Session> {
    const session = createSession(userId, claudeMode)
    this.sessions.set(session.id, session)
    return session
  }

  findByUserId(userId: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId)
  }

  async findById(id: string): Promise<Session | undefined> {
    return this.sessions.get(id)
  }

  async updateState(id: string, state: SessionState): Promise<void> {
    const session = this.sessions.get(id)
    if (session) {
      session.state = state
      session.updatedAt = Date.now()
    }
  }

  async updateClaudeSessionId(id: string, claudeSessionId: string): Promise<void> {
    this.claudeSessionIds.set(id, claudeSessionId)
  }

  getClaudeSessionId(id: string): string {
    return this.claudeSessionIds.get(id) ?? ''
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id)
    this.claudeSessionIds.delete(id)
  }
}
