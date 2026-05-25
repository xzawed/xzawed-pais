import type { SessionRepo } from '../db/session.repo.js'

export type SessionState = 'idle' | 'running' | 'waiting_info'

export interface SessionEntry {
  state: SessionState
  abortController: AbortController
  infoResolve: ((value: string) => void) | null
  infoReject: ((reason: Error) => void) | null
}

const dbErr = (op: string, id: string) => (err: unknown) =>
  console.error(`[SessionStore] ${op} failed for ${id}:`, err)

export class SessionStore {
  private readonly sessions = new Map<string, SessionEntry>()

  constructor(private readonly repo?: SessionRepo) {}

  create(sessionId: string): void {
    if (this.sessions.has(sessionId)) throw new Error(`Session ${sessionId} already exists`)
    this.sessions.set(sessionId, { state: 'idle', abortController: new AbortController(), infoResolve: null, infoReject: null })
    void this.repo?.insert(sessionId).catch(dbErr('insert', sessionId))
  }

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId)
  }

  waitForInfo(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (session.state === 'waiting_info') throw new Error(`Session ${sessionId} is already waiting for info`)
    session.state = 'waiting_info'
    void this.repo?.updateState(sessionId, 'waiting_info').catch(dbErr('updateState(waiting_info)', sessionId))
    return new Promise<string>((resolve, reject) => {
      session.infoResolve = resolve
      session.infoReject = reject
    })
  }

  resolveInfo(sessionId: string, answer: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.infoResolve) return
    session.infoResolve(answer)
    session.infoResolve = null
    session.infoReject = null
    session.state = 'running'
    void this.repo?.updateState(sessionId, 'running').catch(dbErr('updateState(running)', sessionId))
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.abortController.abort()
    // Replace controller so the session can be reused after abort
    entry.abortController = new AbortController()
    if (entry.infoReject) {
      entry.infoReject(new Error('Session aborted'))
      entry.infoResolve = null
      entry.infoReject = null
    }
    entry.state = 'idle'
    void this.repo?.updateState(sessionId, 'idle').catch(dbErr('updateState(idle)', sessionId))
  }

  getAbortSignal(sessionId: string): AbortSignal | undefined {
    return this.sessions.get(sessionId)?.abortController.signal
  }

  delete(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (entry?.infoReject) {
      entry.infoReject(new Error('Session deleted while waiting for info'))
      entry.infoResolve = null
      entry.infoReject = null
    }
    this.sessions.delete(sessionId)
    void this.repo?.remove(sessionId).catch(dbErr('remove', sessionId))
  }
}
