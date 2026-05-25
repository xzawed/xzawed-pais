import { vi, describe, it, expect, beforeEach } from 'vitest'
import { WatcherStore } from './watcher-store.js'
import type { WatchEntry } from './watcher-store.js'

function makeEntry(watcherId = 'w-1'): WatchEntry & { watcher: { close: ReturnType<typeof vi.fn> } } {
  return {
    watcherId,
    watcher: { close: vi.fn().mockResolvedValue(undefined) },
    timers: new Map(),
  }
}

let store: WatcherStore

beforeEach(() => {
  store = new WatcherStore(3)
})

describe('WatcherStore.add', () => {
  it('adds an entry', () => {
    store.add('sess-1', makeEntry())
    expect(store.size).toBe(1)
  })

  it('throws when maxWatchers is exceeded', () => {
    store.add('sess-1', makeEntry('w-1'))
    store.add('sess-2', makeEntry('w-2'))
    store.add('sess-3', makeEntry('w-3'))
    expect(() => store.add('sess-4', makeEntry('w-4'))).toThrow('최대 감시자 수')
  })

  it('returns entry via get()', () => {
    const entry = makeEntry()
    store.add('sess-1', entry)
    expect(store.get('sess-1')).toBe(entry)
  })
})

describe('WatcherStore.remove', () => {
  it('returns undefined for missing sessionId', async () => {
    const result = await store.remove('nonexistent')
    expect(result).toBeUndefined()
  })

  it('closes the watcher and clears timers', async () => {
    const entry = makeEntry()
    const fakeTimer = setTimeout(() => {}, 9999)
    entry.timers.set('file.ts', fakeTimer)
    store.add('sess-1', entry)

    const removed = await store.remove('sess-1')
    expect(removed).toBe(entry)
    expect(entry.watcher.close).toHaveBeenCalledOnce()
    expect(entry.timers.size).toBe(0)
    expect(store.size).toBe(0)
  })

  it('decrements size after removal', async () => {
    store.add('sess-1', makeEntry('w-1'))
    store.add('sess-2', makeEntry('w-2'))
    await store.remove('sess-1')
    expect(store.size).toBe(1)
  })
})

describe('WatcherStore.stopAll', () => {
  it('closes all watchers', async () => {
    const e1 = makeEntry('w-1')
    const e2 = makeEntry('w-2')
    store.add('sess-1', e1)
    store.add('sess-2', e2)

    await store.stopAll()
    expect(e1.watcher.close).toHaveBeenCalledOnce()
    expect(e2.watcher.close).toHaveBeenCalledOnce()
    expect(store.size).toBe(0)
  })
})
