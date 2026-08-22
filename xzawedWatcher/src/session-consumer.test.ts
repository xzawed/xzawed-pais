import { describe, it, expect, vi } from 'vitest'
import { withWatcherCleanup } from './session-consumer.js'

function makeParts() {
  const order: string[] = []
  const consumer = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    close: vi.fn().mockImplementation(async () => { order.push('consumer.close') }),
  }
  const store = {
    remove: vi.fn().mockImplementation(async () => { order.push('store.remove'); return undefined }),
  }
  return { consumer, store, order }
}

describe('withWatcherCleanup — 세션 종료 시 감시 자원 회수 (5-B)', () => {
  it('T12 — close()가 그 세션의 FSWatcher·타이머를 회수한다', async () => {
    const { consumer, store } = makeParts()
    const wrapped = withWatcherCleanup(consumer, store, 'sess-1')

    await wrapped.close?.()

    expect(store.remove).toHaveBeenCalledWith('sess-1')
    expect(consumer.close).toHaveBeenCalledTimes(1)
  })

  it('store.remove가 consumer.close보다 먼저 — 감시 종료 발행이 살아있는 연결을 쓴다', async () => {
    const { consumer, store, order } = makeParts()
    await withWatcherCleanup(consumer, store, 'sess-1').close?.()

    expect(order).toEqual(['store.remove', 'consumer.close'])
  })

  it('start/stop은 그대로 위임한다', async () => {
    const { consumer, store } = makeParts()
    const wrapped = withWatcherCleanup(consumer, store, 'sess-1')

    await wrapped.start('sess-1')
    wrapped.stop()

    expect(consumer.start).toHaveBeenCalledWith('sess-1')
    expect(consumer.stop).toHaveBeenCalledTimes(1)
  })

  it('close()를 두 번 불러도 안전하다 (store.remove는 없으면 undefined)', async () => {
    const { consumer, store } = makeParts()
    const wrapped = withWatcherCleanup(consumer, store, 'sess-1')

    await wrapped.close?.()
    await expect(wrapped.close?.()).resolves.toBeUndefined()
    expect(store.remove).toHaveBeenCalledTimes(2)
  })

  it('감시 중이던 세션은 close 시 실제로 store에서 빠진다', async () => {
    const removed: string[] = []
    const store = { remove: vi.fn().mockImplementation(async (sid: string) => { removed.push(sid); return { watcherId: 'w1' } }) }
    const consumer = { start: vi.fn(), stop: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }

    await withWatcherCleanup(consumer as never, store as never, 'sess-watching').close?.()
    expect(removed).toEqual(['sess-watching'])
  })
})
