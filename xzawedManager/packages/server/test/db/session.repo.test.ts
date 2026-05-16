import { describe, it, expect, vi } from 'vitest'
import { SessionStore } from '../../src/sessions/session.store.js'
import type { SessionRepo } from '../../src/db/session.repo.js'

function makeRepo(): SessionRepo {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    updateState: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionRepo
}

describe('SessionStore with SessionRepo', () => {
  it('calls repo.insert on create', () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    store.create('s1')
    expect(repo.insert).toHaveBeenCalledWith('s1')
  })

  it('calls repo.updateState(waiting_info) on waitForInfo', () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    store.create('s1')
    void store.waitForInfo('s1')
    expect(repo.updateState).toHaveBeenCalledWith('s1', 'waiting_info')
  })

  it('calls repo.updateState(running) on resolveInfo', async () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    store.create('s1')
    const p = store.waitForInfo('s1')
    store.resolveInfo('s1', 'answer')
    await p
    expect(repo.updateState).toHaveBeenCalledWith('s1', 'running')
  })

  it('calls repo.updateState(idle) on abort', () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    store.create('s1')
    store.abort('s1')
    expect(repo.updateState).toHaveBeenCalledWith('s1', 'idle')
  })

  it('calls repo.remove on delete', () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    store.create('s1')
    store.delete('s1')
    expect(repo.remove).toHaveBeenCalledWith('s1')
  })

  it('works without repo (backward compatible)', () => {
    const store = new SessionStore()
    store.create('s1')
    store.delete('s1')
    expect(store.get('s1')).toBeUndefined()
  })
})
