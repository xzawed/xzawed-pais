import { Redis } from 'ioredis'
import { validateWorkspaceRoot } from '@xzawed/agent-streams'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { Producer } from './streams/producer.js'
import { Consumer } from './streams/consumer.js'
import { WatcherStore } from './watcher-store.js'
import { Watcher } from './watcher.js'

async function main() {
  const config = loadConfig()
  validateWorkspaceRoot(config.workspaceRoot) // throws if root is filesystem root

  const redis = new Redis(config.redisUrl)
  const producer = new Producer(redis)
  const store = new WatcherStore(config.maxWatchers)
  const watcher = new Watcher(producer, store, config)

  const sessionId = process.env.WATCHER_SESSION_ID ?? 'default'
  const consumer = new Consumer(redis, (msg) => watcher.handle(msg))

  const server = createServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedWatcher listening on :${config.port} (session: ${sessionId})`)

  consumer.start(sessionId).catch(console.error)

  const cleanup = async () => {
    consumer.stop()
    await store.stopAll()
    await server.close()
    await redis.quit()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
