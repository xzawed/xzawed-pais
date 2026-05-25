import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from './server.js'

describe('createServer', () => {
  const app = createServer()

  afterEach(async () => {
    await app.close()
  })

  it('GET /health가 200과 status:ok를 반환한다', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('xzawedPlanner')
  })
})
