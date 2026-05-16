import { describe, it, expect, beforeEach } from 'vitest'
import { SessionStore } from '../sessions/session.store.js'

describe('SessionStore', () => {
  let store: SessionStore

  beforeEach(() => {
    store = new SessionStore()
  })

  it('create: returns session with correct userId and claudeMode', () => {
    const s = store.create('alice', 'cli')
    expect(s.userId).toBe('alice')
    expect(s.claudeMode).toBe('cli')
    expect(s.state).toBe('active')
    expect(typeof s.id).toBe('string')
    expect(s.id.length).toBeGreaterThan(0)
  })

  it('create: sets createdAt and updatedAt timestamps', () => {
    const before = Date.now()
    const s = store.create('alice', 'cli')
    const after = Date.now()
    expect(s.createdAt).toBeGreaterThanOrEqual(before)
    expect(s.createdAt).toBeLessThanOrEqual(after)
    expect(s.updatedAt).toBe(s.createdAt)
  })

  it('findById: returns session after create', () => {
    const s = store.create('bob', 'api')
    expect(store.findById(s.id)).toBe(s)
  })

  it('findById: returns undefined for unknown id', () => {
    expect(store.findById('nonexistent')).toBeUndefined()
  })

  it('findByUserId: returns all sessions for a user', () => {
    store.create('alice', 'cli')
    store.create('alice', 'api')
    store.create('bob', 'cli')
    expect(store.findByUserId('alice')).toHaveLength(2)
    expect(store.findByUserId('bob')).toHaveLength(1)
    expect(store.findByUserId('charlie')).toHaveLength(0)
  })

  it('findByUserId: returns empty array when store is empty', () => {
    expect(store.findByUserId('anyone')).toEqual([])
  })

  it('updateState: changes state and bumps updatedAt', () => {
    const s = store.create('alice', 'cli')
    const before = s.updatedAt
    store.updateState(s.id, 'waiting_manager')
    expect(s.state).toBe('waiting_manager')
    expect(s.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('updateState: no-op for unknown id', () => {
    expect(() => store.updateState('ghost', 'error')).not.toThrow()
  })

  it('delete: removes session from store', () => {
    const s = store.create('alice', 'cli')
    store.delete(s.id)
    expect(store.findById(s.id)).toBeUndefined()
  })

  it('delete: does not affect other sessions', () => {
    const s1 = store.create('alice', 'cli')
    const s2 = store.create('bob', 'cli')
    store.delete(s1.id)
    expect(store.findById(s2.id)).toBe(s2)
  })

  it('delete: no-op for unknown id', () => {
    expect(() => store.delete('ghost')).not.toThrow()
  })

  it('multiple creates produce unique ids', () => {
    const ids = Array.from({ length: 5 }, () => store.create('user', 'cli').id)
    expect(new Set(ids).size).toBe(5)
  })
})
