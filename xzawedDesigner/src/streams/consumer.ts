import { hostname } from 'node:os'
import type { Redis } from 'ioredis'
import { BaseConsumer } from '@xzawed/agent-streams'
import { ManagerToDesignerMessageSchema, type ManagerToDesignerMessage } from '../types.js'

export class Consumer extends BaseConsumer<ManagerToDesignerMessage> {
  constructor(
    redis: Redis,
    onMessage: (msg: ManagerToDesignerMessage) => Promise<void>,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(redis, onMessage, 'designer-consumers', `designer-${hostname()}-${process.pid}`, 'manager:to-designer', ManagerToDesignerMessageSchema, sleep)
  }
}
