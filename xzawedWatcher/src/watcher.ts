import chokidar from 'chokidar'
import type { ManagerToWatcherMessage, FileEvent } from './types.js'
import type { Producer } from './streams/producer.js'
import type { WatcherStore } from './watcher-store.js'
import { validatePath } from './executor.js'
import type { Config } from './config.js'

export class Watcher {
  constructor(
    private readonly producer: Producer,
    private readonly store: WatcherStore,
    private readonly config: Config,
  ) {}

  async handle(message: ManagerToWatcherMessage): Promise<void> {
    const { sessionId, payload } = message
    const base = {
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    if (message.type === 'abort' || message.type === 'stop_watch') {
      const entry = await this.store.remove(sessionId)
      if (entry) {
        await this.producer.publish(sessionId, {
          ...base,
          type: 'watch_stopped',
          payload: { watcherId: entry.watcherId, content: `감시 중단: ${sessionId}` },
        })
      }
      return
    }

    try {
      const validPath = await validatePath(payload.projectPath, this.config.workspaceRoot)
      const debounceMs = payload.debounceMs ?? this.config.debounceMs
      const watcherId = crypto.randomUUID()
      const timers = new Map<string, ReturnType<typeof setTimeout>>()

      const queueEvent = (eventType: FileEvent['event'], filePath: string) => {
        const existing = timers.get(filePath)
        if (existing !== undefined) clearTimeout(existing)

        const timer = setTimeout(() => {
          timers.delete(filePath)
          void this.producer.publish(sessionId, {
            sessionId,
            messageId: crypto.randomUUID(),
            timestamp: Date.now(),
            type: 'file_changed',
            payload: {
              watcherId,
              changes: [{ path: filePath, event: eventType, timestamp: Date.now() }],
              content: `파일 변경: ${filePath}`,
            },
          })
        }, debounceMs)

        timers.set(filePath, timer)
      }

      const watchedPaths = payload.triggers.length > 0 ? payload.triggers : ['**/*']
      const fsWatcher = chokidar.watch(watchedPaths, {
        cwd: validPath,
        ignored: /(node_modules|\.git)/,
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
      })

      fsWatcher.on('add', (p) => queueEvent('add', p))
      fsWatcher.on('change', (p) => queueEvent('change', p))
      fsWatcher.on('unlink', (p) => queueEvent('unlink', p))

      this.store.add(sessionId, { watcherId, watcher: fsWatcher, timers })

      await this.producer.publish(sessionId, {
        ...base,
        type: 'watch_started',
        payload: { watcherId, content: `감시 시작: ${validPath}` },
      })
    } catch (err: unknown) {
      await this.producer.publish(sessionId, {
        ...base,
        type: 'error',
        payload: { content: err instanceof Error ? err.message : 'Unknown error' },
      })
    }
  }
}
