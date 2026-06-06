import type { Redis } from 'ioredis'
import { RedisEventBus } from '@xzawed/agent-streams'
import type { BuilderToManagerMessage } from '../types.js'

export class Producer {
  private readonly bus: RedisEventBus
  constructor(redis: Redis) {
    this.bus = new RedisEventBus(redis)
  }

  async publish(sessionId: string, message: BuilderToManagerMessage): Promise<void> {
    await this.bus.publish(`builder:to-manager:${sessionId}`, message)
  }
}
