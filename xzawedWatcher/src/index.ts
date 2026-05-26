import { Redis } from 'ioredis'
import { validateWorkspaceRoot, SessionDispatcher } from '@xzawed/agent-streams'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { Producer } from './streams/producer.js'
import { Consumer } from './streams/consumer.js'
import { WatcherStore } from './watcher-store.js'
import { Watcher } from './watcher.js'

async function main() {
  const config = loadConfig()
  validateWorkspaceRoot(config.workspaceRoot) // throws if root is filesystem root

  const gatewayRedis = new Redis(config.redisUrl)
  const store = new WatcherStore(config.maxWatchers)

  const dispatcher = new SessionDispatcher(
    gatewayRedis,
    'manager:to-watcher:sessions',
    'watcher-session-dispatcher',
    (_sessionId: string) => {
      const sessionRedis = new Redis(config.redisUrl)
      const producer = new Producer(sessionRedis)
      const watcher = new Watcher(producer, store, config)
      return new Consumer(sessionRedis, (msg) => watcher.handle(msg))
    },
  )

  const server = createServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedWatcher listening on :${config.port}`)

  dispatcher.start().catch(console.error)

  const cleanup = async () => {
    dispatcher.stop()
    await store.stopAll()
    await server.close()
    await gatewayRedis.quit()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
