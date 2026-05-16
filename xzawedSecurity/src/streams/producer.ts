import type { Redis } from 'ioredis'
import type { SecurityToManagerMessage } from '../types.js'

export class Producer {
  constructor(private readonly redis: Redis) {}

  async publish(sessionId: string, message: SecurityToManagerMessage): Promise<void> {
    const stream = `security:to-manager:${sessionId}`
    await this.redis.xadd(stream, '*', 'data', JSON.stringify(message))
  }
}
