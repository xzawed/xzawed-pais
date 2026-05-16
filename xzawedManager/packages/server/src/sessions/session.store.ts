import type { SessionRepo } from '../db/session.repo.js'

export type SessionState = 'idle' | 'running' | 'waiting_info'

export interface SessionEntry {
  state: SessionState
  abortController: AbortController
  infoResolve: ((value: string) => void) | null
}

export class SessionStore {
  private sessions = new Map<string, SessionEntry>()

  constructor(private repo?: SessionRepo) {}

  create(sessionId: string): void {
    if (this.sessions.has(sessionId)) throw new Error(`Session ${sessionId} already exists`)
    this.sessions.set(sessionId, { state: 'idle', abortController: new AbortController(), infoResolve: null })
    void this.repo?.insert(sessionId)
  }

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId)
  }

  waitForInfo(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (session.state === 'waiting_info') throw new Error(`Session ${sessionId} is already waiting for info`)
    session.state = 'waiting_info'
    void this.repo?.updateState(sessionId, 'waiting_info')
    return new Promise<string>((resolve) => {
      session.infoResolve = resolve
    })
  }

  resolveInfo(sessionId: string, answer: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.infoResolve) return
    session.infoResolve(answer)
    session.infoResolve = null
    session.state = 'running'
    void this.repo?.updateState(sessionId, 'running')
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.abortController.abort()
    if (entry.infoResolve) {
      entry.infoResolve('')
      entry.infoResolve = null
    }
    entry.state = 'idle'
    void this.repo?.updateState(sessionId, 'idle')
  }

  getAbortSignal(sessionId: string): AbortSignal | undefined {
    return this.sessions.get(sessionId)?.abortController.signal
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
    void this.repo?.remove(sessionId)
  }
}
