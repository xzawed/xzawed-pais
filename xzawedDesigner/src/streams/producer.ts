import type { Redis } from 'ioredis'
import type { DesignerToManagerMessage } from '../types.js'

export class Producer {
  constructor(private readonly redis: Redis) {}

  async publish(sessionId: string, message: DesignerToManagerMessage): Promise<void> {
    const stream = `designer:to-manager:${sessionId}`
    await this.redis.xadd(stream, '*', 'data', JSON.stringify(message))
  }
}
