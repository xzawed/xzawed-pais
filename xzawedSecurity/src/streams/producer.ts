import type { Redis } from 'ioredis'
import { RedisEventBus } from '@xzawed/agent-streams'
import type { SecurityToManagerMessage } from '../types.js'

export class Producer {
  private readonly bus: RedisEventBus
  constructor(redis: Redis) {
    this.bus = new RedisEventBus(redis)
  }

  async publish(sessionId: string, message: SecurityToManagerMessage): Promise<void> {
    await this.bus.publish(`security:to-manager:${sessionId}`, message)
  }
}
