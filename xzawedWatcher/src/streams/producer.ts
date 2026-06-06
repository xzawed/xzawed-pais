import type { Redis } from 'ioredis'
import { RedisEventBus } from '@xzawed/agent-streams'
import type { WatcherToManagerMessage } from '../types.js'

export class Producer {
  private readonly bus: RedisEventBus
  constructor(redis: Redis) {
    this.bus = new RedisEventBus(redis)
  }

  async publish(sessionId: string, message: WatcherToManagerMessage): Promise<void> {
    await this.bus.publish(`watcher:to-manager:${sessionId}`, message, { maxlen: 1000 })
  }
}
