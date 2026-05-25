import { describe, it, expect, beforeEach } from 'vitest'
import { SessionStore } from './session.store.js'

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

    it('throws when sessionId already exists', () => {
      store.create('s1')
      expect(() => store.create('s1')).toThrowError('Session s1 already exists')
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

    it('throws when session is already waiting_info', () => {
      store.create('s1')
      store.waitForInfo('s1')
      expect(() => store.waitForInfo('s1')).toThrowError(
        'Session s1 is already waiting for info',
      )
    })

    it('throws when session does not exist', () => {
      expect(() => store.waitForInfo('nonexistent')).toThrowError(
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
})
