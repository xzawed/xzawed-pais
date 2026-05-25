import { loadConfig } from './config.js'
import { buildServer } from './server.js'

try {
  const config = loadConfig()
  const app = await buildServer(config)
  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedOrchestrator server running on port ${config.port}`)
  console.log(`CLAUDE_MODE=${config.claudeMode} | MODE=${config.mode}`)
} catch (err) {
  console.error('Failed to start xzawedOrchestrator:', err)
  process.exit(1)
}
