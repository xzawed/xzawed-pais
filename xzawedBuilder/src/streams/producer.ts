import type { Redis } from 'ioredis'
import type { BuilderToManagerMessage } from '../types.js'

export class Producer {
  constructor(private readonly redis: Redis) {}

  async publish(sessionId: string, message: BuilderToManagerMessage): Promise<void> {
    const stream = `builder:to-manager:${sessionId}`
    await this.redis.xadd(stream, '*', 'data', JSON.stringify(message))
  }
}
