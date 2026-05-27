import { hostname } from 'node:os'
import type { Redis } from 'ioredis'
import { BaseConsumer } from '@xzawed/agent-streams'
import { ManagerToBuilderMessageSchema, type ManagerToBuilderMessage } from '../types.js'

export class Consumer extends BaseConsumer<ManagerToBuilderMessage> {
  constructor(
    redis: Redis,
    onMessage: (msg: ManagerToBuilderMessage) => Promise<void>,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(redis, onMessage, 'builder-consumers', `builder-${hostname()}-${process.pid}`, 'manager:to-builder', ManagerToBuilderMessageSchema, sleep)
  }
}
