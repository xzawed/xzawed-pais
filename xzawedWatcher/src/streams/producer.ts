import type { Redis } from 'ioredis'
import type { WatcherToManagerMessage } from '../types.js'

export class Producer {
  constructor(private readonly redis: Redis) {}

  async publish(sessionId: string, message: WatcherToManagerMessage): Promise<void> {
    const stream = `watcher:to-manager:${sessionId}`
    await this.redis.xadd(stream, 'MAXLEN', '~', '1000', '*', 'data', JSON.stringify(message))
  }
}
