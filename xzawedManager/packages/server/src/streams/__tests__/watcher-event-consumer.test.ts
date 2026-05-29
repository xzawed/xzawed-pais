import { describe, it, expect, vi } from 'vitest'
import { WatcherEventConsumer } from '../watcher-event-consumer.js'

describe('WatcherEventConsumer', () => {
  it('생성 시 redisUrl과 onFileChanged 콜백을 받는다', () => {
    const cb = vi.fn()
    const consumer = new WatcherEventConsumer('redis://localhost', cb)
    expect(consumer).toBeDefined()
  })

  it('start()와 stop() 메서드가 존재한다', () => {
    const consumer = new WatcherEventConsumer('redis://localhost', vi.fn())
    expect(typeof consumer.start).toBe('function')
    expect(typeof consumer.stop).toBe('function')
  })

  it('watchSession()과 unwatchSession() 메서드가 존재한다', () => {
    const consumer = new WatcherEventConsumer('redis://localhost', vi.fn())
    expect(typeof consumer.watchSession).toBe('function')
    expect(typeof consumer.unwatchSession).toBe('function')
  })
})
