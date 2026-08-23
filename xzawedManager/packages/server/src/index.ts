import { loadConfig } from './config.js'
import { buildServer } from './server.js'
import { createShutdown } from './shutdown.js'
import { closeRedisClients } from './streams/redis.client.js'

try {
  const config = loadConfig()
  const { app, stopIntake, closeResources } = await buildServer(config)

  // 재진입 가드와 워치독은 createShutdown 안에 있다 — 이 파일은 import 만 해도 서버를
  // 띄우는 최상위 await 스크립트라 여기 두면 테스트할 방법이 없다.
  const shutdown = createShutdown({
    stopIntake,
    closeServer: () => app.close(),
    closeResources,
    closeRedis: closeRedisClients,
  })

  process.on('SIGTERM', () => { void shutdown() })
  process.on('SIGINT', () => { void shutdown() })

  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  console.log(`xzawedManager running on port ${config.PORT}`)
} catch (err) {
  console.error('Failed to start xzawedManager:', err)
  process.exit(1)
}
