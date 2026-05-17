import type { Redis } from 'ioredis'
import { BaseConsumer } from '@xzawed/agent-streams'
import { ManagerToTesterMessageSchema, type ManagerToTesterMessage } from '../types.js'

export class Consumer extends BaseConsumer<ManagerToTesterMessage> {
  constructor(
    redis: Redis,
    onMessage: (msg: ManagerToTesterMessage) => Promise<void>,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(redis, onMessage, 'tester-consumers', 'tester-1', 'manager:to-tester', ManagerToTesterMessageSchema, sleep)
  }
}
