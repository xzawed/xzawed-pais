import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerJwt, verifyServiceToken } from './jwt.plugin.js'

const SECRET = 'a-secret-key-that-is-at-least-32-characters-long'

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await registerJwt(app, SECRET)
  app.get('/protected', { preHandler: verifyServiceToken }, async () => ({ ok: true }))
  await app.ready()
  return app
}

describe('verifyServiceToken', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  it('returns 401 with Missing token when no Authorization header', async () => {
    app = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'Missing token' })
  })

  it('returns 401 with Token expired for expired JWT', async () => {
    app = await buildTestApp()
    const token = app.jwt.sign({ sub: 'test' }, { expiresIn: -1 })
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'Token expired' })
  })

  it('returns 401 with Invalid token for bad signature', async () => {
    app = await buildTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer invalid.token.here' },
    })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid token' })
  })

  it('returns 200 for valid JWT', async () => {
    app = await buildTestApp()
    const token = app.jwt.sign({ sub: 'test' })
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
  })
})
