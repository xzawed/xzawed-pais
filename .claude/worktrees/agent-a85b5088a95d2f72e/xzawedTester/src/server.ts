import Fastify from 'fastify'

export function createServer() {
  const app = Fastify({ logger: false })

  app.get('/health', async () => ({
    status: 'ok',
    service: 'xzawedTester',
  }))

  return app
}
