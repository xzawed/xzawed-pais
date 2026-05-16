import type { Session, SessionState, ClaudeMode } from '@xzawed/shared'
import { createSession } from './session.js'

export class SessionStore {
  private sessions = new Map<string, Session>()

  create(userId: string, claudeMode: ClaudeMode): Session {
    const session = createSession(userId, claudeMode)
    this.sessions.set(session.id, session)
    return session
  }

  findById(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  findByUserId(userId: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId)
  }

  updateState(id: string, state: SessionState): void {
    const session = this.sessions.get(id)
    if (session) {
      session.state = state
      session.updatedAt = Date.now()
    }
  }

  delete(id: string): void {
    this.sessions.delete(id)
  }
}
