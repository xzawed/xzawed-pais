import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const { mockWatcherInstance, mockWatchFn } = vi.hoisted(() => {
  const mockWatcherInstance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const mockWatchFn = vi.fn().mockReturnValue(mockWatcherInstance)
  return { mockWatcherInstance, mockWatchFn }
})

vi.mock('chokidar', () => ({
  default: { watch: mockWatchFn },
}))

vi.mock('./executor.js', () => ({
  validatePath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
}))

import { validatePath } from './executor.js'
import { Watcher } from './watcher.js'
import { WatcherStore } from './watcher-store.js'
import type { ManagerToWatcherMessage } from './types.js'

const mockValidatePath = vi.mocked(validatePath)
const mockPublish = vi.fn().mockResolvedValue(undefined)

const config = {
  redisUrl: 'redis://localhost:6379',
  port: 3007,
  mode: 'local' as const,
  workspaceRoot: '/workspace',
  maxWatchers: 10,
  debounceMs: 300,
}

function makeRequest(overrides?: Partial<ManagerToWatcherMessage['payload']>): ManagerToWatcherMessage {
  return {
    sessionId: 'sess-1',
    messageId: 'msg-1',
    timestamp: Date.now(),
    type: 'watch_request',
    payload: { projectPath: '/workspace/app', triggers: ['**/*.ts'], context: {}, ...overrides },
  }
}

function getRegisteredHandler(eventName: string): ((p: string) => void) | undefined {
  const call = mockWatcherInstance.on.mock.calls.find((c) => c[0] === eventName)
  return call?.[1] as ((p: string) => void) | undefined
}

let store: WatcherStore
let watcher: Watcher

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mockValidatePath.mockImplementation((p: string) => Promise.resolve(p))
  mockPublish.mockResolvedValue(undefined)
  mockWatcherInstance.on.mockReturnThis()
  mockWatcherInstance.close.mockResolvedValue(undefined)
  store = new WatcherStore(10)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  watcher = new Watcher({ publish: mockPublish } as any, store, config)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Watcher.handle — watch_request', () => {
  it('publishes watch_started', async () => {
    await watcher.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ type: 'watch_started' }),
    )
  })

  it('adds entry to store', async () => {
    await watcher.handle(makeRequest())
    expect(store.size).toBe(1)
  })

  it('calls chokidar.watch with triggers as pattern', async () => {
    await watcher.handle(makeRequest({ triggers: ['**/*.ts'] }))
    expect(mockWatchFn).toHaveBeenCalledWith(
      ['**/*.ts'],
      expect.objectContaining({ cwd: '/workspace/app' }),
    )
  })

  it('uses ["**/*"] when triggers is empty', async () => {
    await watcher.handle(makeRequest({ triggers: [] }))
    expect(mockWatchFn).toHaveBeenCalledWith(
      ['**/*'],
      expect.any(Object),
    )
  })

  it('registers add, change, unlink handlers on chokidar', async () => {
    await watcher.handle(makeRequest())
    expect(mockWatcherInstance.on).toHaveBeenCalledWith('add', expect.any(Function))
    expect(mockWatcherInstance.on).toHaveBeenCalledWith('change', expect.any(Function))
    expect(mockWatcherInstance.on).toHaveBeenCalledWith('unlink', expect.any(Function))
  })

  it('publishes file_changed after debounce when change event fires', async () => {
    await watcher.handle(makeRequest())
    const changeHandler = getRegisteredHandler('change')
    expect(changeHandler).toBeDefined()

    changeHandler!('/workspace/app/src/index.ts')
    expect(mockPublish).toHaveBeenCalledTimes(1) // only watch_started so far

    await vi.advanceTimersByTimeAsync(300)
    expect(mockPublish).toHaveBeenCalledTimes(2)
    expect(mockPublish).toHaveBeenLastCalledWith(
      'sess-1',
      expect.objectContaining({ type: 'file_changed' }),
    )
  })

  it('debounces multiple rapid changes to same file', async () => {
    await watcher.handle(makeRequest())
    const changeHandler = getRegisteredHandler('change')!

    changeHandler('/workspace/app/file.ts')
    changeHandler('/workspace/app/file.ts')
    changeHandler('/workspace/app/file.ts')

    await vi.advanceTimersByTimeAsync(300)
    // watch_started + one file_changed (debounced)
    expect(mockPublish).toHaveBeenCalledTimes(2)
  })

  it('publishes separate file_changed for different files', async () => {
    await watcher.handle(makeRequest())
    const changeHandler = getRegisteredHandler('change')!
    const addHandler = getRegisteredHandler('add')!

    changeHandler('/workspace/app/a.ts')
    addHandler('/workspace/app/b.ts')

    await vi.advanceTimersByTimeAsync(300)
    // watch_started + 2 file_changed
    expect(mockPublish).toHaveBeenCalledTimes(3)
  })

  it('publishes error when validatePath throws', async () => {
    mockValidatePath.mockRejectedValueOnce(new Error('경로 거부: /etc'))
    await watcher.handle(makeRequest({ projectPath: '/etc' }))
    expect(mockPublish).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'error',
        payload: expect.objectContaining({ content: '경로 거부: /etc' }),
      }),
    )
  })

  it('publishes error when maxWatchers exceeded', async () => {
    const smallStore = new WatcherStore(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = new Watcher({ publish: mockPublish } as any, smallStore, config)
    await w.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ type: 'error' }),
    )
  })
})

describe('Watcher.handle — stop_watch', () => {
  it('publishes watch_stopped and removes from store', async () => {
    await watcher.handle(makeRequest())
    expect(store.size).toBe(1)

    await watcher.handle({
      sessionId: 'sess-1',
      messageId: 'msg-2',
      timestamp: Date.now(),
      type: 'stop_watch',
      payload: { projectPath: '/workspace/app', triggers: [], context: {} },
    })

    expect(store.size).toBe(0)
    expect(mockPublish).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ type: 'watch_stopped' }),
    )
  })

  it('clears pending debounce timers on stop', async () => {
    await watcher.handle(makeRequest())
    const changeHandler = getRegisteredHandler('change')!
    changeHandler('/workspace/app/file.ts') // queue event

    await watcher.handle({
      sessionId: 'sess-1',
      messageId: 'msg-2',
      timestamp: Date.now(),
      type: 'stop_watch',
      payload: { projectPath: '/workspace/app', triggers: [], context: {} },
    })

    await vi.advanceTimersByTimeAsync(300)
    // watch_started + watch_stopped — no file_changed
    const types = mockPublish.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(types).not.toContain('file_changed')
  })

  it('does nothing if no watcher exists for session', async () => {
    await watcher.handle({
      sessionId: 'sess-999',
      messageId: 'msg-1',
      timestamp: Date.now(),
      type: 'stop_watch',
      payload: { projectPath: '/workspace/app', triggers: [], context: {} },
    })
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

describe('Watcher.handle — abort', () => {
  it('stops watcher and publishes watch_stopped', async () => {
    await watcher.handle(makeRequest())
    await watcher.handle({
      sessionId: 'sess-1',
      messageId: 'msg-3',
      timestamp: Date.now(),
      type: 'abort',
      payload: { projectPath: '/workspace/app', triggers: [], context: {} },
    })
    expect(store.size).toBe(0)
    const types = mockPublish.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(types).toContain('watch_stopped')
  })
})
