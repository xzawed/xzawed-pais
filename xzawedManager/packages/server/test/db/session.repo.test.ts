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
  it('calls repo.insert on create', async () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    await store.create('s1')
    expect(repo.insert).toHaveBeenCalledWith('s1')
  })

  it('calls repo.updateState(waiting_info) on waitForInfo', async () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    await store.create('s1')
    void store.waitForInfo('s1')
    await new Promise((r) => setImmediate(r)) // updateState는 append 후(비동기) 발생 — 양보
    expect(repo.updateState).toHaveBeenCalledWith('s1', 'waiting_info')
  })

  it('calls repo.updateState(running) on resolveInfo', async () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    await store.create('s1')
    const p = store.waitForInfo('s1')
    await store.resolveInfo('s1', 'answer')
    await p
    expect(repo.updateState).toHaveBeenCalledWith('s1', 'running')
  })

  it('calls repo.updateState(idle) on abort', async () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    await store.create('s1')
    await store.abort('s1')
    expect(repo.updateState).toHaveBeenCalledWith('s1', 'idle')
  })

  it('calls repo.remove on delete', async () => {
    const repo = makeRepo()
    const store = new SessionStore(repo)
    await store.create('s1')
    await store.delete('s1')
    expect(repo.remove).toHaveBeenCalledWith('s1')
  })

  it('works without repo (backward compatible)', async () => {
    const store = new SessionStore()
    await store.create('s1')
    await store.delete('s1')
    expect(store.get('s1')).toBeUndefined()
  })
})
