import { describe, it, expect, beforeEach } from 'vitest'
import { InMemorySessionStore } from '../sessions/session.store.js'

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore

  beforeEach(() => {
    store = new InMemorySessionStore()
  })

  it('create: returns session with correct userId and claudeMode', async () => {
    const s = await store.create('alice', null, 'cli')
    expect(s.userId).toBe('alice')
    expect(s.claudeMode).toBe('cli')
    expect(s.state).toBe('active')
    expect(typeof s.id).toBe('string')
    expect(s.id.length).toBeGreaterThan(0)
  })

  it('create: sets createdAt and updatedAt timestamps', async () => {
    const before = Date.now()
    const s = await store.create('alice', null, 'cli')
    const after = Date.now()
    expect(s.createdAt).toBeGreaterThanOrEqual(before)
    expect(s.createdAt).toBeLessThanOrEqual(after)
    expect(s.updatedAt).toBe(s.createdAt)
  })

  it('findById: returns session after create', async () => {
    const s = await store.create('bob', null, 'api')
    expect(await store.findById(s.id)).toBe(s)
  })

  it('findById: returns undefined for unknown id', async () => {
    expect(await store.findById('nonexistent')).toBeUndefined()
  })

  it('findByUserId: returns all sessions for a user', async () => {
    await store.create('alice', null, 'cli')
    await store.create('alice', null, 'api')
    await store.create('bob', null, 'cli')
    expect(store.findByUserId('alice')).toHaveLength(2)
    expect(store.findByUserId('bob')).toHaveLength(1)
    expect(store.findByUserId('charlie')).toHaveLength(0)
  })

  it('findByUserId: returns empty array when store is empty', () => {
    expect(store.findByUserId('anyone')).toEqual([])
  })

  it('updateState: changes state and bumps updatedAt', async () => {
    const s = await store.create('alice', null, 'cli')
    const before = s.updatedAt
    await store.updateState(s.id, 'waiting_manager')
    expect(s.state).toBe('waiting_manager')
    expect(s.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('updateState: no-op for unknown id', async () => {
    await expect(store.updateState('ghost', 'error')).resolves.toBeUndefined()
  })

  it('updateClaudeSessionId: stores and retrieves id', async () => {
    const s = await store.create('alice', null, 'cli')
    await store.updateClaudeSessionId(s.id, 'claude-abc')
    expect(store.getClaudeSessionId(s.id)).toBe('claude-abc')
  })

  it('delete: removes session from store', async () => {
    const s = await store.create('alice', null, 'cli')
    await store.delete(s.id)
    expect(await store.findById(s.id)).toBeUndefined()
  })

  it('delete: does not affect other sessions', async () => {
    const s1 = await store.create('alice', null, 'cli')
    const s2 = await store.create('bob', null, 'cli')
    await store.delete(s1.id)
    expect(await store.findById(s2.id)).toBe(s2)
  })

  it('delete: no-op for unknown id', async () => {
    await expect(store.delete('ghost')).resolves.toBeUndefined()
  })

  it('updateProject: updates projectId and bumps updatedAt', async () => {
    const s = await store.create('alice', null, 'cli')
    const before = s.updatedAt
    await store.updateProject(s.id, 'proj-1')
    expect(s.projectId).toBe('proj-1')
    expect(s.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('updateProject: no-op for unknown id', async () => {
    await expect(store.updateProject('ghost', 'proj-1')).resolves.toBeUndefined()
  })

  it('multiple creates produce unique ids', async () => {
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => store.create('user', null, 'cli').then(s => s.id))
    )
    expect(new Set(ids).size).toBe(5)
  })
})
