import type { Redis } from 'ioredis'
import { BaseConsumer } from '@xzawed/agent-streams'
import { ManagerToPlannerMessageSchema, type ManagerToPlannerMessage } from '../types.js'

export class Consumer extends BaseConsumer<ManagerToPlannerMessage> {
  constructor(
    redis: Redis,
    onMessage: (msg: ManagerToPlannerMessage) => Promise<void>,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(redis, onMessage, 'planner-consumers', 'planner-1', 'manager:to-planner', ManagerToPlannerMessageSchema, sleep)
  }
}
