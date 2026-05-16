import { describe, it, expect } from 'vitest'
import { SessionStore } from '../../src/sessions/session.store.js'

describe('SessionStore', () => {
  it('creates a session in idle state', () => {
    const store = new SessionStore()
    store.create('sess-1')
    expect(store.get('sess-1')?.state).toBe('idle')
  })

  it('throws if session already exists', () => {
    const store = new SessionStore()
    store.create('s1')
    expect(() => store.create('s1')).toThrow()
  })

  it('resolves waitForInfo when resolveInfo is called', async () => {
    const store = new SessionStore()
    store.create('sess-1')

    const promise = store.waitForInfo('sess-1')
    store.resolveInfo('sess-1', 'user answer')
    const answer = await promise

    expect(answer).toBe('user answer')
    expect(store.get('sess-1')?.state).toBe('running')
  })

  it('sets state to waiting_info when waitForInfo is called', () => {
    const store = new SessionStore()
    store.create('sess-1')
    void store.waitForInfo('sess-1')
    expect(store.get('sess-1')?.state).toBe('waiting_info')
  })

  it('abort resolves pending waitForInfo with empty string', async () => {
    const store = new SessionStore()
    store.create('sess-1')
    const promise = store.waitForInfo('sess-1')
    store.abort('sess-1')
    const answer = await promise
    expect(answer).toBe('')
  })

  it('abort signals the AbortController', () => {
    const store = new SessionStore()
    store.create('sess-1')
    const signal = store.getAbortSignal('sess-1')
    expect(signal).toBeDefined()
    expect(signal!.aborted).toBe(false)
    store.abort('sess-1')
    expect(signal!.aborted).toBe(true)
  })

  it('delete removes session', () => {
    const store = new SessionStore()
    store.create('sess-1')
    store.delete('sess-1')
    expect(store.get('sess-1')).toBeUndefined()
  })

  it('getAbortSignal returns undefined for unknown session', () => {
    const store = new SessionStore()
    expect(store.getAbortSignal('nonexistent')).toBeUndefined()
  })

  it('waitForInfo throws for unknown session', () => {
    const store = new SessionStore()
    expect(() => store.waitForInfo('nonexistent')).toThrow()
  })

  it('resolveInfo silently ignores unknown session', () => {
    const store = new SessionStore()
    // Should not throw
    expect(() => store.resolveInfo('nonexistent', 'value')).not.toThrow()
  })
})
