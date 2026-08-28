import { Redis } from 'ioredis'
import { validateWorkspaceRoot, SessionDispatcher, agentReadinessProbes } from '@xzawed/agent-streams'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { Producer } from './streams/producer.js'
import { Consumer } from './streams/consumer.js'
import { WatcherStore } from './watcher-store.js'
import { withWatcherCleanup } from './session-consumer.js'
import { Watcher } from './watcher.js'

async function main() {
  const config = loadConfig()
  validateWorkspaceRoot(config.workspaceRoot) // throws if root is filesystem root

  const redisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    connectTimeout: 2000,
    retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined,
  }
  const gatewayRedis = new Redis(config.redisUrl, redisOptions)
  const store = new WatcherStore(config.maxWatchers)

  const dispatcher = new SessionDispatcher(
    gatewayRedis,
    'manager:to-watcher:sessions',
    'watcher-session-dispatcher',
    (sessionId: string) => {
      const sessionRedis = new Redis(config.redisUrl, redisOptions)
      const producer = new Producer(sessionRedis)
      const watcher = new Watcher(producer, store, config)
      const consumer = new Consumer(sessionRedis, (msg) => watcher.handle(msg))
      return withWatcherCleanup(consumer, store, sessionId)
    },
  )

  // readiness 프로브를 여기서 조립한다 — Redis 도달성 + **디스패처 루프 가동 여부**.
  // 후자가 없으면 Redis 가 살아난 뒤에도 "살아 있지만 귀머거리"인 상태를 못 잡는다.
  // 프로브 전용 연결 — 디스패처와 공유하면 안 된다(근거는 shared `agentReadinessProbes`).
  // cleanup 에서 quit 하지 않는다: 유휴 연결이고 cleanup 은 process.exit(0) 로 끝나 소켓이
  // 프로세스와 함께 닫힌다. 여기서 quit 을 부르면 종료 블록이 7종에서 CPD 임계를 넘는다(실측 4 clones).
  const probeRedis = new Redis(config.redisUrl, redisOptions)
  const server = createServer(agentReadinessProbes(probeRedis, dispatcher))
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedWatcher listening on :${config.port}`)

  dispatcher.start().catch(console.error)

  const cleanup = async () => {
    await dispatcher.close()
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
