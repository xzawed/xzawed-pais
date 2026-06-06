import { z } from 'zod'
import type { Redis } from 'ioredis'
import { RedisEventBus } from '@xzawed/agent-streams'
import type { DesignerToManagerMessage } from '../types.js'

const UUID_SCHEMA = z.string().uuid()

export class Producer {
  private readonly bus: RedisEventBus
  constructor(redis: Redis) {
    this.bus = new RedisEventBus(redis)
  }

  async publish(sessionId: string, message: DesignerToManagerMessage): Promise<void> {
    UUID_SCHEMA.parse(sessionId)
    await this.bus.publish(`designer:to-manager:${sessionId}`, message)
  }
}
