import { describe, it, expect, beforeEach } from 'vitest'
import { InMemorySessionStore } from '../../src/sessions/session.store.js'

describe('SessionStore', () => {
  let store: InMemorySessionStore

  beforeEach(() => {
    store = new InMemorySessionStore()
  })

  it('creates a session with unique id', async () => {
    const s1 = await store.create('user-1', null, 'cli')
    const s2 = await store.create('user-1', null, 'cli')
    expect(s1.id).not.toBe(s2.id)
    expect(s1.state).toBe('active')
    expect(s1.claudeMode).toBe('cli')
  })

  it('finds session by id', async () => {
    const created = await store.create('user-1', null, 'api')
    const found = await store.findById(created.id)
    expect(found).toEqual(created)
  })

  it('returns undefined for missing session', async () => {
    expect(await store.findById('non-existent')).toBeUndefined()
  })

  it('updates session state', async () => {
    const session = await store.create('user-1', null, 'cli')
    await store.updateState(session.id, 'waiting_manager')
    expect((await store.findById(session.id))?.state).toBe('waiting_manager')
  })

  it('lists sessions by userId', async () => {
    await store.create('user-1', null, 'cli')
    await store.create('user-1', null, 'cli')
    await store.create('user-2', null, 'cli')
    expect(store.findByUserId('user-1')).toHaveLength(2)
  })
})
