import { z } from 'zod'
import type { Redis } from 'ioredis'
import type { DeveloperToManagerMessage } from '../types.js'

const UUID_SCHEMA = z.string().uuid()

export class Producer {
  constructor(private readonly redis: Redis) {}

  async publish(sessionId: string, message: DeveloperToManagerMessage): Promise<void> {
    UUID_SCHEMA.parse(sessionId)
    const stream = `developer:to-manager:${sessionId}`
    await this.redis.xadd(stream, '*', 'data', JSON.stringify(message))
  }
}
