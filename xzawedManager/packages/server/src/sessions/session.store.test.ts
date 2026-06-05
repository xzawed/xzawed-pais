import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SessionStore } from './session.store.js'
import { DEFAULT_GATE_CONFIG } from '../gates/approval-gate.js'

describe('SessionStore', () => {
  let store: SessionStore

  beforeEach(() => {
    store = new SessionStore()
  })

  // ─── create() ────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a session in idle state', () => {
      store.create('s1')
      const entry = store.get('s1')
      expect(entry).toBeDefined()
      expect(entry?.state).toBe('idle')
      expect(entry?.infoResolve).toBeNull()
      expect(entry?.infoReject).toBeNull()
      expect(entry?.abortController).toBeInstanceOf(AbortController)
    })

    it('throws when sessionId already exists', async () => {
      await store.create('s1')
      await expect(store.create('s1')).rejects.toThrowError('Session s1 already exists')
    })
  })

  // ─── get() ───────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns undefined for unknown session', () => {
      expect(store.get('nonexistent')).toBeUndefined()
    })

    it('returns the entry for a known session', () => {
      store.create('s1')
      const entry = store.get('s1')
      expect(entry).toBeDefined()
      expect(entry?.state).toBe('idle')
    })
  })

  // ─── waitForInfo() ───────────────────────────────────────────────────────

  describe('waitForInfo()', () => {
    it('transitions to waiting_info and returns a Promise', () => {
      store.create('s1')
      const p = store.waitForInfo('s1')
      expect(p).toBeInstanceOf(Promise)
      expect(store.get('s1')?.state).toBe('waiting_info')
    })

    it('throws when session is already waiting_info', async () => {
      await store.create('s1')
      void store.waitForInfo('s1')
      await expect(store.waitForInfo('s1')).rejects.toThrowError(
        'Session s1 is already waiting for info',
      )
    })

    it('throws when session does not exist', async () => {
      await expect(store.waitForInfo('nonexistent')).rejects.toThrowError(
        'Session nonexistent not found',
      )
    })
  })

  // ─── resolveInfo() ───────────────────────────────────────────────────────

  describe('resolveInfo()', () => {
    it('resolves the waiting Promise and transitions to running', async () => {
      store.create('s1')
      const p = store.waitForInfo('s1')
      store.resolveInfo('s1', 'answer42')
      const result = await p
      expect(result).toBe('answer42')
      const entry = store.get('s1')
      expect(entry?.state).toBe('running')
      expect(entry?.infoResolve).toBeNull()
      expect(entry?.infoReject).toBeNull()
    })

    it('is a no-op when session is not waiting (no throw)', () => {
      store.create('s1')
      expect(() => store.resolveInfo('s1', 'anything')).not.toThrow()
      expect(store.get('s1')?.state).toBe('idle')
    })

    it('is a no-op when session does not exist (no throw)', () => {
      expect(() => store.resolveInfo('nonexistent', 'anything')).not.toThrow()
    })
  })

  // ─── abort() ─────────────────────────────────────────────────────────────

  describe('abort()', () => {
    it('aborts a waiting_info session and transitions to idle', async () => {
      store.create('s1')
      const p = store.waitForInfo('s1')
      store.abort('s1')
      await expect(p).rejects.toThrowError('Session aborted')
      expect(store.get('s1')?.state).toBe('idle')
    })

    it('replaces AbortController after abort so the signal is fresh', () => {
      store.create('s1')
      const originalSignal = store.getAbortSignal('s1')
      store.abort('s1')
      const newSignal = store.getAbortSignal('s1')
      expect(newSignal).not.toBe(originalSignal)
      expect(newSignal?.aborted).toBe(false)
    })

    it('clears infoResolve and infoReject after aborting waiting session', async () => {
      store.create('s1')
      const p = store.waitForInfo('s1')
      store.abort('s1')
      await p.catch(() => undefined) // swallow rejection
      const entry = store.get('s1')
      expect(entry?.infoResolve).toBeNull()
      expect(entry?.infoReject).toBeNull()
    })

    it('works without error on an idle session', () => {
      store.create('s1')
      expect(() => store.abort('s1')).not.toThrow()
      expect(store.get('s1')?.state).toBe('idle')
    })

    it('is a no-op when session does not exist (no throw)', () => {
      expect(() => store.abort('nonexistent')).not.toThrow()
    })
  })

  // ─── delete() ────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('removes the session entry', () => {
      store.create('s1')
      store.delete('s1')
      expect(store.get('s1')).toBeUndefined()
    })

    it('rejects the waiting Promise when deleting a waiting_info session', async () => {
      store.create('s1')
      const p = store.waitForInfo('s1')
      store.delete('s1')
      await expect(p).rejects.toThrowError(
        'Session deleted while waiting for info',
      )
    })

    it('clears infoResolve / infoReject before deleting', async () => {
      store.create('s1')
      const p = store.waitForInfo('s1')
      store.delete('s1')
      await p.catch(() => undefined)
      // entry is gone — just confirm no crash
      expect(store.get('s1')).toBeUndefined()
    })

    it('deletes an idle session without error', () => {
      store.create('s1')
      expect(() => store.delete('s1')).not.toThrow()
      expect(store.get('s1')).toBeUndefined()
    })
  })

  // ─── getAbortSignal() ────────────────────────────────────────────────────

  describe('getAbortSignal()', () => {
    it('returns undefined for an unknown session', () => {
      expect(store.getAbortSignal('nonexistent')).toBeUndefined()
    })

    it('returns the AbortSignal for a known session', () => {
      store.create('s1')
      const signal = store.getAbortSignal('s1')
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal?.aborted).toBe(false)
    })
  })

  // ─── race: abort + resolveInfo ───────────────────────────────────────────

  describe('abort + resolveInfo race', () => {
    it('resolveInfo after abort is a no-op — Promise already rejected', async () => {
      store.create('s1')
      const p = store.waitForInfo('s1')
      store.abort('s1') // rejects p and clears infoResolve/infoReject
      store.resolveInfo('s1', 'too-late') // should be no-op
      await expect(p).rejects.toThrowError('Session aborted')
      // state remains idle (not running) because resolveInfo was no-op
      expect(store.get('s1')?.state).toBe('idle')
    })
  })

  // ─── gateConfig ──────────────────────────────────────────────────────────

  describe('gateConfig', () => {
    it('생성 시 기본 게이트 설정(manual)', () => {
      store.create('s1')
      expect(store.getGateConfig('s1')).toEqual(DEFAULT_GATE_CONFIG)
    })
    it('없는 세션은 기본 설정 반환', () => {
      expect(store.getGateConfig('nope')).toEqual(DEFAULT_GATE_CONFIG)
    })
    it('단계별 override 설정', () => {
      store.create('s1')
      store.setGateOverride('s1', 'plan_task', 'auto')
      expect(store.getGateConfig('s1').overrides['plan_task']).toBe('auto')
    })
    it('전역 기본 모드 설정', () => {
      store.create('s1')
      store.setGateDefaultMode('s1', 'auto')
      expect(store.getGateConfig('s1').defaultMode).toBe('auto')
    })
    it('한 세션의 override가 다른 세션에 누설되지 않는다', () => {
      store.create('s1')
      store.create('s2')
      store.setGateOverride('s1', 'plan_task', 'auto')
      expect(store.getGateConfig('s2').overrides['plan_task']).toBeUndefined()
    })
  })
})

// ─── event-sourced 경로 ────────────────────────────────────────────────────

function makeFakeEventStore() {
  const appended: Array<{ type: string; payload: unknown; prevEventId: string | null }> = []
  let n = 0
  return {
    appended,
    appendSessionEvent: vi.fn(async (input: { type: string; payload: unknown; prevEventId: string | null }) => {
      appended.push({ type: input.type, payload: input.payload, prevEventId: input.prevEventId })
      return { eventId: `evt-${n++}` }
    }),
  }
}

describe('SessionStore — event-sourced 경로', () => {
  it('순차 전이(create→abort→delete)마다 이벤트를 append하고 causation을 연결한다', async () => {
    const es = makeFakeEventStore()
    const store = new SessionStore(undefined, es as never)
    await store.create('s1') // SessionCreated, prevEventId=null → evt-0
    await store.abort('s1')  // SessionStateChanged(idle), prevEventId='evt-0' → evt-1
    await store.delete('s1') // SessionDeleted, prevEventId='evt-1' → evt-2
    expect(es.appended.map((a) => a.type)).toEqual(['SessionCreated', 'SessionStateChanged', 'SessionDeleted'])
    expect(es.appended[0]?.prevEventId).toBeNull()
    expect(es.appended[1]?.prevEventId).toBe('evt-0')
    expect(es.appended[2]?.prevEventId).toBe('evt-1')
  })

  it('waitForInfo→resolveInfo 전이도 각각 이벤트를 append한다(production: resolveInfo는 별도 메시지로 도착)', async () => {
    const es = makeFakeEventStore()
    const store = new SessionStore(undefined, es as never)
    await store.create('s1')
    const waitP = store.waitForInfo('s1') // runner가 await — append 완료 후 wait
    await new Promise((r) => setImmediate(r)) // waitForInfo append 완료까지 양보
    await store.resolveInfo('s1', 'ans')
    await waitP
    expect(es.appended.map((a) => a.type)).toEqual(['SessionCreated', 'SessionStateChanged', 'SessionStateChanged'])
  })

  it('restoreSession으로 replay 결과를 인메모리 투영에 주입한다', () => {
    const store = new SessionStore()
    store.restoreSession('s9', 'running', 'evt-last', 3)
    expect(store.get('s9')?.state).toBe('running')
  })
})
