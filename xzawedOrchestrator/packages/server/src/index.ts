import { loadConfig } from './config.js'
import { buildServer } from './server.js'
import { createShutdown } from './shutdown.js'
import { closeRedisClients } from './streams/redis.client.js'

try {
  const config = loadConfig()
  const app = await buildServer(config)

  // 소비자 정지와 DB 풀 종료는 app.close() 안에서 일어난다. Fastify 의 onClose 훅은
  // 등록 역순(LIFO — 실측)으로 실행되므로 등록 1번째인 closePool 이 소비자 정지 훅들보다
  // **나중에** 돈다. index.ts 가 추가로 책임지는 것은 Redis 정리와 종료 코드뿐이다.
  const shutdown = createShutdown({
    closeServer: () => app.close(),
    closeRedis: closeRedisClients,
  })
  process.on('SIGTERM', () => { void shutdown() })
  process.on('SIGINT', () => { void shutdown() })

  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedOrchestrator server running on port ${config.port}`)
  console.log(`CLAUDE_MODE=${config.claudeMode} | MODE=${config.mode}`)
} catch (err) {
  console.error('Failed to start xzawedOrchestrator:', err)
  process.exit(1)
}
