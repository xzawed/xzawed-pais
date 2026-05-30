import { Redis } from 'ioredis'
import { validateWorkspaceRoot, SessionDispatcher } from '@xzawed/agent-streams'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { Producer } from './streams/producer.js'
import { Consumer } from './streams/consumer.js'
import { ClaudeRunner } from './claude/runner.js'
import { Builder } from './builder.js'

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
  const runner = new ClaudeRunner(config.anthropicApiKey, config.claudeModel)

  const dispatcher = new SessionDispatcher(
    gatewayRedis,
    'manager:to-builder:sessions',
    'builder-session-dispatcher',
    (_sessionId: string) => {
      const sessionRedis = new Redis(config.redisUrl, redisOptions)
      const producer = new Producer(sessionRedis)
      const builder = new Builder(producer, runner, config)
      return new Consumer(sessionRedis, (msg) => builder.handle(msg))
    },
  )

  const server = createServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedBuilder listening on :${config.port}`)

  dispatcher.start().catch(console.error)

  const cleanup = async () => {
    dispatcher.stop()
    await server.close()
    await gatewayRedis.quit()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
}

await main().catch((err: unknown) => {
  console.error('Fatal:', err)
  process.exit(1)
})
