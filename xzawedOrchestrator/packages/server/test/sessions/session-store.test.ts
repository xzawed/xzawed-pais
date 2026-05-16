import { describe, it, expect, beforeEach } from 'vitest'

describe('SessionStore', () => {
  let store: import('../../src/sessions/session.store.js').SessionStore

  beforeEach(async () => {
    const { SessionStore } = await import('../../src/sessions/session.store.js')
    store = new SessionStore()
  })

  it('creates a session with unique id', () => {
    const s1 = store.create('user-1', 'cli')
    const s2 = store.create('user-1', 'cli')
    expect(s1.id).not.toBe(s2.id)
    expect(s1.state).toBe('active')
    expect(s1.claudeMode).toBe('cli')
  })

  it('finds session by id', () => {
    const created = store.create('user-1', 'api')
    const found = store.findById(created.id)
    expect(found).toEqual(created)
  })

  it('returns undefined for missing session', () => {
    expect(store.findById('non-existent')).toBeUndefined()
  })

  it('updates session state', () => {
    const session = store.create('user-1', 'cli')
    store.updateState(session.id, 'waiting_manager')
    expect(store.findById(session.id)?.state).toBe('waiting_manager')
  })

  it('lists sessions by userId', () => {
    store.create('user-1', 'cli')
    store.create('user-1', 'cli')
    store.create('user-2', 'cli')
    expect(store.findByUserId('user-1')).toHaveLength(2)
  })
})
