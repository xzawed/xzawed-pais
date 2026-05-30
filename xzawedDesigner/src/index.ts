import { Redis } from 'ioredis'
import { validateWorkspaceRoot, SessionDispatcher } from '@xzawed/agent-streams'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { Producer } from './streams/producer.js'
import { Consumer } from './streams/consumer.js'
import { ClaudeRunner } from './claude/runner.js'
import { Designer } from './designer.js'

async function main() {
  const config = loadConfig()
  validateWorkspaceRoot(config.workspaceRoot) // throws if root is filesystem root

  const gatewayRedis = new Redis(config.redisUrl)
  const runner = new ClaudeRunner(config.anthropicApiKey, config.claudeModel)

  const dispatcher = new SessionDispatcher(
    gatewayRedis,
    'manager:to-designer:sessions',
    'designer-session-dispatcher',
    (_sessionId: string) => {
      const sessionRedis = new Redis(config.redisUrl)
      const producer = new Producer(sessionRedis)
      const designer = new Designer(producer, runner)
      return new Consumer(sessionRedis, (msg) => designer.handle(msg))
    },
  )

  const server = createServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedDesigner listening on :${config.port}`)

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
