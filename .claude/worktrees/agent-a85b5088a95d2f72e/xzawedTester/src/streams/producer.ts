import type { Redis } from 'ioredis'
import type { TesterToManagerMessage } from '../types.js'

export class Producer {
  constructor(private readonly redis: Redis) {}

  async publish(sessionId: string, message: TesterToManagerMessage): Promise<void> {
    const stream = `tester:to-manager:${sessionId}`
    await this.redis.xadd(stream, '*', 'data', JSON.stringify(message))
  }
}
