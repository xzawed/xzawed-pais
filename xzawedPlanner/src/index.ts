import { Redis } from 'ioredis'
import { SessionDispatcher } from '@xzawed/agent-streams'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { Producer } from './streams/producer.js'
import { Consumer } from './streams/consumer.js'
import { ClaudeRunner } from './claude/runner.js'
import { Planner } from './planner.js'

async function main() {
  const config = loadConfig()

  const gatewayRedis = new Redis(config.redisUrl)
  const runner = new ClaudeRunner(config.anthropicApiKey, config.claudeModel)

  const dispatcher = new SessionDispatcher(
    gatewayRedis,
    'manager:to-planner:sessions',
    'planner-session-dispatcher',
    (_sessionId: string) => {
      const sessionRedis = new Redis(config.redisUrl)
      const producer = new Producer(sessionRedis)
      const planner = new Planner(producer, runner)
      return new Consumer(sessionRedis, (msg) => planner.handle(msg))
    },
  )

  const server = createServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedPlanner listening on :${config.port}`)

  dispatcher.start().catch(console.error)

  const cleanup = async () => {
    dispatcher.stop()
    await server.close()
    await gatewayRedis.quit()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
}

await main().catch((err: unknown) => {
  console.error('Fatal:', err)
  process.exit(1)
})
