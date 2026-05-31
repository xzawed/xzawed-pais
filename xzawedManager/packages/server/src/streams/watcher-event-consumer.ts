import { getRedisClient } from './redis.client.js'
import type { Redis } from 'ioredis'

const WATCHER_STREAM_PREFIX = 'watcher:to-manager:'
const CONSUMER_GROUP = 'manager-watcher-consumers'
const CONSUMER_NAME = 'manager-watcher-0'
const BLOCK_MS = 3_000
const MAX_SESSIONS = 1_000

interface FileChangedEvent {
  sessionId: string
  path: string
  event: 'add' | 'change' | 'unlink'
  timestamp: number
}

type OnFileChanged = (event: FileChangedEvent) => Promise<void>

export class WatcherEventConsumer {
  private _running = false
  private _redis: Redis | null = null
  private readonly _watchedSessions = new Set<string>()

  constructor(
    private readonly redisUrl: string,
    private readonly onFileChanged: OnFileChanged,
  ) {}

  private get redis(): Redis {
    this._redis ??= getRedisClient(this.redisUrl)
    return this._redis
  }

  watchSession(sessionId: string): void {
    if (this._watchedSessions.size >= MAX_SESSIONS) return
    this._watchedSessions.add(sessionId)
  }

  unwatchSession(sessionId: string): void {
    this._watchedSessions.delete(sessionId)
  }

  start(): void {
    this._running = true
    void this._loop()
  }

  stop(): void {
    this._running = false
    this._redis?.disconnect()  // 진행 중인 BLOCK 즉시 중단
    this._redis = null
  }

  private async _ensureGroups(streams: string[]): Promise<void> {
    for (const stream of streams) {
      try {
        await this.redis.xgroup('CREATE', stream, CONSUMER_GROUP, '$', 'MKSTREAM')
      } catch (e: unknown) {
        if (e instanceof Error && !e.message.includes('BUSYGROUP')) {
          // 새 스트림이면 BUSYGROUP이 아닌 에러는 무시
        }
      }
    }
  }

  private async _processMessage(
    streamKey: string,
    msgId: string,
    fields: string[],
    sessionId: string,
  ): Promise<void> {
    const dataIdx = fields.indexOf('data')
    try {
      if (dataIdx !== -1) {
        const parsed = JSON.parse(fields[dataIdx + 1] ?? '{}') as Record<string, unknown>
        if (parsed['type'] === 'file_changed' && parsed['payload']) {
          const payload = parsed['payload'] as Record<string, unknown>
          await this.onFileChanged({
            sessionId,
            path:      String(payload['path'] ?? ''),
            event:     (payload['event'] as 'add' | 'change' | 'unlink') ?? 'change',
            timestamp: Number(payload['timestamp'] ?? Date.now()),
          })
        }
      }
    } catch {
      // 파싱/처리 실패 무시
    } finally {
      await this.redis.xack(streamKey, CONSUMER_GROUP, msgId)
    }
  }

  private async _processResults(
    results: [string, [string, string[]][]][],
  ): Promise<void> {
    for (const [streamKey, messages] of results) {
      const sessionId = streamKey.replace(WATCHER_STREAM_PREFIX, '')
      for (const [msgId, fields] of messages) {
        await this._processMessage(streamKey, msgId, fields, sessionId)
      }
    }
  }

  private async _readOnce(streams: string[], lastIds: string[]): Promise<boolean> {
    await this._ensureGroups(streams)
    const results = await this.redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', '50', 'BLOCK', String(BLOCK_MS),
      'STREAMS', ...streams, ...lastIds,
    ) as [string, [string, string[]][]][] | null

    if (results) await this._processResults(results)
    return true
  }

  private async _loop(): Promise<void> {
    while (this._running) {
      const sessions = [...this._watchedSessions]
      if (sessions.length === 0) {
        await new Promise<void>(r => setTimeout(r, BLOCK_MS))
        continue
      }

      const streams = sessions.map(id => `${WATCHER_STREAM_PREFIX}${id}`)
      const lastIds = sessions.map(() => '>')

      try {
        await this._readOnce(streams, lastIds)
      } catch (err) {
        if (!this._running) break
        if (err instanceof Error && err.message.includes('NOGROUP')) {
          // 스트림이 삭제되어 consumer group이 없는 경우 — 다음 반복에서 재생성
          continue
        }
        console.error('[WatcherEventConsumer] xreadgroup error:', err)
        await new Promise<void>(r => setTimeout(r, 1_000))
      }
    }
  }
}
