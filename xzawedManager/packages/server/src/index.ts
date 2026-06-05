import { loadConfig } from './config.js'
import { buildServer } from './server.js'
import { closeRedisClients } from './streams/redis.client.js'

try {
  const config = loadConfig()
  const { app, closeAll } = await buildServer(config)

  let isShuttingDown = false
  const shutdown = async () => {
    if (isShuttingDown) return
    isShuttingDown = true
    await closeAll()
    await app.close()
    await closeRedisClients()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  console.log(`xzawedManager running on port ${config.PORT}`)
} catch (err) {
  console.error('Failed to start xzawedManager:', err)
  process.exit(1)
}
