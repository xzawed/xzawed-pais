import type { SessionRepo } from '../db/session.repo.js'
import type { EventStore, SessionEventType } from '../db/event-store.js'
import { DEFAULT_GATE_CONFIG, type GateConfig, type GateMode } from '../gates/approval-gate.js'

export type SessionState = 'idle' | 'running' | 'waiting_info'

export interface SessionEntry {
  state: SessionState
  abortController: AbortController
  infoResolve: ((value: string) => void) | null
  infoReject: ((reason: Error) => void) | null
  gateConfig: GateConfig
  /** 이벤트소싱: 세션 내 다음 이벤트 순번(causation 추적용). */
  evSeq: number
  /** 이벤트소싱: 직전 이벤트 eventId(causation). 첫 이벤트는 null. */
  prevEventId: string | null
}

const dbErr = (op: string, id: string) => (err: unknown) =>
  console.error(`[SessionStore] ${op} failed for ${id}:`, err)

function newEntry(state: SessionState, evSeq = 0, prevEventId: string | null = null): SessionEntry {
  return {
    state,
    abortController: new AbortController(),
    infoResolve: null,
    infoReject: null,
    gateConfig: { defaultMode: DEFAULT_GATE_CONFIG.defaultMode, overrides: {} },
    evSeq,
    prevEventId,
  }
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionEntry>()

  constructor(
    private readonly repo?: SessionRepo,
    private readonly eventStore?: EventStore,
  ) {}

  /** event-sourced 모드면 전이 이벤트를 append하고 세션의 causation 추적을 갱신한다(없으면 no-op). */
  private async appendEvent(
    entry: SessionEntry,
    sessionId: string,
    type: SessionEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.eventStore) return
    const res = await this.eventStore.appendSessionEvent(
      { sessionId, type, payload, prevEventId: entry.prevEventId, perSessionSeq: entry.evSeq },
      `manager:events:${sessionId}`,
    )
    entry.prevEventId = res.eventId
    entry.evSeq += 1
  }

  async create(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) throw new Error(`Session ${sessionId} already exists`)
    const entry = newEntry('idle')
    this.sessions.set(sessionId, entry) // 동기 — legacy 모드 호환(첫 await 전)
    try {
      await this.appendEvent(entry, sessionId, 'SessionCreated', { state: 'idle' })
    } catch (err) {
      this.sessions.delete(sessionId) // event-sourced append 실패 시 투영 롤백
      throw err
    }
    void this.repo?.insert(sessionId).catch(dbErr('insert', sessionId))
  }

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId)
  }

  async waitForInfo(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (session.state === 'waiting_info') throw new Error(`Session ${sessionId} is already waiting for info`)
    session.state = 'waiting_info'
    // resolver를 await 전에 동기 설치 — waitForInfo 직후 resolveInfo 호출 패턴(테스트·동기 경로) 보존
    const promise = new Promise<string>((resolve, reject) => {
      session.infoResolve = resolve
      session.infoReject = reject
    })
    await this.appendEvent(session, sessionId, 'SessionStateChanged', { state: 'waiting_info' })
    void this.repo?.updateState(sessionId, 'waiting_info').catch(dbErr('updateState(waiting_info)', sessionId))
    return promise
  }

  async resolveInfo(sessionId: string, answer: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session?.infoResolve) return
    const resolve = session.infoResolve
    session.infoResolve = null
    session.infoReject = null
    session.state = 'running'
    // append를 waiter wake보다 먼저 — runner가 깨어 다음 전이를 일으키기 전에 prevEventId가 진행되도록(causation 레이스 차단)
    await this.appendEvent(session, sessionId, 'SessionStateChanged', { state: 'running' })
    resolve(answer)
    void this.repo?.updateState(sessionId, 'running').catch(dbErr('updateState(running)', sessionId))
  }

  async abort(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.abortController.abort() // 동기 — in-flight 취소(테스트가 동기 검사)
    // Replace controller so the session can be reused after abort
    entry.abortController = new AbortController()
    entry.state = 'idle'
    // waiter 핸들 capture·clear는 동기(직후 resolveInfo가 no-op이 되도록), 실제 reject 호출만 append 뒤로
    const reject = entry.infoReject
    entry.infoResolve = null
    entry.infoReject = null
    // append를 waiter reject보다 먼저 — 깨어난 경로가 다음 전이를 일으키기 전에 prevEventId 진행
    await this.appendEvent(entry, sessionId, 'SessionStateChanged', { state: 'idle' })
    reject?.(new Error('Session aborted'))
    void this.repo?.updateState(sessionId, 'idle').catch(dbErr('updateState(idle)', sessionId))
  }

  getAbortSignal(sessionId: string): AbortSignal | undefined {
    return this.sessions.get(sessionId)?.abortController.signal
  }

  getGateConfig(sessionId: string): GateConfig {
    return this.sessions.get(sessionId)?.gateConfig ?? DEFAULT_GATE_CONFIG
  }

  setGateOverride(sessionId: string, stage: string, mode: GateMode): void {
    const s = this.sessions.get(sessionId)
    if (s) s.gateConfig.overrides[stage] = mode
  }

  setGateDefaultMode(sessionId: string, mode: GateMode): void {
    const s = this.sessions.get(sessionId)
    if (s) s.gateConfig.defaultMode = mode
  }

  async delete(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (entry?.infoReject) {
      entry.infoReject(new Error('Session deleted while waiting for info'))
      entry.infoResolve = null
      entry.infoReject = null
    }
    this.sessions.delete(sessionId) // 동기 — legacy 모드 호환
    if (entry) await this.appendEvent(entry, sessionId, 'SessionDeleted', {})
    void this.repo?.remove(sessionId).catch(dbErr('remove', sessionId))
  }

  /** replay 결과를 인메모리 투영에 주입한다(휘발 런타임은 새로 생성). */
  restoreSession(sessionId: string, state: SessionState, lastEventId: string, seq: number): void {
    this.sessions.set(sessionId, newEntry(state, seq, lastEventId))
  }
}
