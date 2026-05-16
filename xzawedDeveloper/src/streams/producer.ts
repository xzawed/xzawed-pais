import type { Redis } from 'ioredis'
import type { DeveloperToManagerMessage } from '../types.js'

export class Producer {
  constructor(private readonly redis: Redis) {}

  async publish(sessionId: string, message: DeveloperToManagerMessage): Promise<void> {
    const stream = `developer:to-manager:${sessionId}`
    await this.redis.xadd(stream, '*', 'data', JSON.stringify(message))
  }
}
