import { hostname } from 'node:os'
import type { Redis } from 'ioredis'
import { BaseConsumer } from '@xzawed/agent-streams'
import { ManagerToSecurityMessageSchema, type ManagerToSecurityMessage } from '../types.js'

export class Consumer extends BaseConsumer<ManagerToSecurityMessage> {
  constructor(
    redis: Redis,
    onMessage: (msg: ManagerToSecurityMessage) => Promise<void>,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(redis, onMessage, 'security-consumers', `security-${hostname()}-${process.pid}`, 'manager:to-security', ManagerToSecurityMessageSchema, sleep)
  }
}
