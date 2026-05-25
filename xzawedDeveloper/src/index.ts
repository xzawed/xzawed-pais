import { Redis } from 'ioredis'
import { validateWorkspaceRoot } from '@xzawed/agent-streams'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { Producer } from './streams/producer.js'
import { Consumer } from './streams/consumer.js'
import { ClaudeRunner } from './claude/runner.js'
import { Developer } from './developer.js'

async function main() {
  const config = loadConfig()
  validateWorkspaceRoot(config.workspaceRoot) // throws if root is filesystem root

  const redis = new Redis(config.redisUrl)
  const producer = new Producer(redis)
  const runner = new ClaudeRunner(config.anthropicApiKey, config.claudeModel)
  const developer = new Developer(producer, runner, config)

  const sessionId = process.env.DEVELOPER_SESSION_ID
  if (!sessionId) {
    console.warn('[xzawedDeveloper] DEVELOPER_SESSION_ID not set — consuming from "default" stream only')
  }
  const effectiveSessionId = sessionId ?? 'default'
  const consumer = new Consumer(redis, (msg) => developer.handle(msg))

  const server = createServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedDeveloper listening on :${config.port} (session: ${effectiveSessionId})`)

  consumer.start(effectiveSessionId).catch(console.error)

  const cleanup = async () => {
    consumer.stop()
    await server.close()
    await redis.quit()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
}

await main().catch((err: unknown) => {
  console.error('Fatal:', err)
  process.exit(1)
})
