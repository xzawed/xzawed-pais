import chokidar from 'chokidar'
import path from 'node:path'
import type { ManagerToWatcherMessage, FileEvent } from './types.js'
import type { Producer } from './streams/producer.js'
import type { WatcherStore } from './watcher-store.js'
import { validatePath } from './executor.js'
import type { Config } from './config.js'

export function resolveWorkspaceRoot(
  userContext: { workspaceRoot: string; [key: string]: unknown } | undefined,
  fallback: string | undefined,
): string {
  const resolved = userContext?.workspaceRoot || fallback || process.env.WORKSPACE_ROOT
  if (!resolved) {
    throw new Error('workspaceRoot를 결정할 수 없습니다')
  }
  return resolved
}

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

    const workspaceRoot = resolveWorkspaceRoot(payload.userContext, this.config.workspaceRoot)

    try {
      // Check capacity BEFORE creating the chokidar instance (prevents MAX_WATCHERS race)
      if (this.store.size >= this.config.maxWatchers) {
        throw new Error(`최대 감시자 수(${this.config.maxWatchers}개) 초과`)
      }

      const validPath = await validatePath(payload.projectPath, workspaceRoot)
      const debounceMs = payload.debounceMs ?? this.config.debounceMs
      const watcherId = crypto.randomUUID()
      const timers = new Map<string, ReturnType<typeof setTimeout>>()

      const queueEvent = (eventType: FileEvent['event'], filePath: string) => {
        const existing = timers.get(filePath)
        if (existing !== undefined) clearTimeout(existing)

        const timer = setTimeout(() => {
          timers.delete(filePath)
          this.producer.publish(sessionId, {
            sessionId,
            messageId: crypto.randomUUID(),
            timestamp: Date.now(),
            type: 'file_changed',
            payload: {
              watcherId,
              changes: [{ path: filePath, event: eventType, timestamp: Date.now() }],
              content: `파일 변경: ${filePath}`,
            },
          }).catch((err: unknown) => {
            console.error('[Watcher] Failed to publish file_changed event:', err)
          })
        }, debounceMs)

        timers.set(filePath, timer)
      }

      const safeTriggers = payload.triggers.filter(t => !path.isAbsolute(t) && !t.includes('..'))
      const watchedPaths = safeTriggers.length > 0 ? safeTriggers : ['**/*']
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
      fsWatcher.on('error', (err: unknown) => {
        const content = err instanceof Error ? err.message : String(err)
        this.producer.publish(sessionId, {
          sessionId,
          messageId: crypto.randomUUID(),
          timestamp: Date.now(),
          type: 'error',
          payload: { content: `감시자 오류: ${content}` },
        }).catch((publishErr: unknown) => {
          console.error('[Watcher] Failed to publish error event:', publishErr)
        })
      })

      try {
        this.store.add(sessionId, { watcherId, watcher: fsWatcher, timers })
      } catch (storeErr: unknown) {
        await fsWatcher.close()
        throw storeErr
      }

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
