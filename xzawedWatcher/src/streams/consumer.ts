import { hostname } from 'node:os'
import type { Redis } from 'ioredis'
import { BaseConsumer } from '@xzawed/agent-streams'
import { ManagerToWatcherMessageSchema, type ManagerToWatcherMessage } from '../types.js'

export class Consumer extends BaseConsumer<ManagerToWatcherMessage> {
  constructor(
    redis: Redis,
    onMessage: (msg: ManagerToWatcherMessage) => Promise<void>,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(redis, onMessage, 'watcher-consumers', `watcher-${hostname()}-${process.pid}`, 'manager:to-watcher', ManagerToWatcherMessageSchema, sleep)
  }
}
