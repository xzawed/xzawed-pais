import { Redis } from 'ioredis'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { Producer } from './streams/producer.js'
import { Consumer } from './streams/consumer.js'
import { ClaudeRunner } from './claude/runner.js'
import { Security } from './security.js'

async function main() {
  const config = loadConfig()

  const redis = new Redis(config.redisUrl)
  const producer = new Producer(redis)
  const runner = new ClaudeRunner(config.anthropicApiKey, config.claudeModel)
  const security = new Security(producer, runner, config)

  const sessionId = process.env.SECURITY_SESSION_ID ?? 'default'
  const consumer = new Consumer(redis, (msg) => security.handle(msg))

  const server = createServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedSecurity listening on :${config.port} (session: ${sessionId})`)

  consumer.start(sessionId).catch(console.error)

  process.on('SIGTERM', async () => {
    consumer.stop()
    await server.close()
    await redis.quit()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
