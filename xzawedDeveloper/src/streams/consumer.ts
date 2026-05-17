import type { Redis } from 'ioredis'
import { BaseConsumer } from '@xzawed/agent-streams'
import { ManagerToDeveloperMessageSchema, type ManagerToDeveloperMessage } from '../types.js'

export class Consumer extends BaseConsumer<ManagerToDeveloperMessage> {
  constructor(
    redis: Redis,
    onMessage: (msg: ManagerToDeveloperMessage) => Promise<void>,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(redis, onMessage, 'developer-consumers', 'developer-1', 'manager:to-developer', ManagerToDeveloperMessageSchema, sleep)
  }
}
