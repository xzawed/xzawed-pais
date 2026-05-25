import type { Redis } from 'ioredis'
import type { PlannerToManagerMessage } from '../types.js'

export class Producer {
  constructor(private readonly redis: Redis) {}

  async publish(sessionId: string, message: PlannerToManagerMessage): Promise<void> {
    const stream = `planner:to-manager:${sessionId}`
    await this.redis.xadd(stream, '*', 'data', JSON.stringify(message))
  }
}
