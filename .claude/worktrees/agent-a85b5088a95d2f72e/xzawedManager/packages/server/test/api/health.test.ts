import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { healthRoute } from '../../src/api/health.route.js'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = Fastify()
    await app.register(healthRoute)
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' })
  })
})
