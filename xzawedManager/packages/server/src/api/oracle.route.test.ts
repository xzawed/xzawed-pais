import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { oracleRoute } from './oracle.route.js'

function appWith(repo: unknown) {
  const app = Fastify()
  return app.register(oracleRoute, { oracleRepo: repo as never }).then(() => app)
}

describe('oracleRoute', () => {
  it('POST 생성 — 유효 본문이면 201·upsert 호출', async () => {
    const repo = { upsert: vi.fn().mockResolvedValue(undefined) }
    const app = await appWith(repo)
    const res = await app.inject({ method: 'POST', url: '/workflows/wf1/oracles', payload: { oracleId: 'o1', storyId: 's1' } })
    expect(res.statusCode).toBe(201)
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ oracleId: 'o1', workflowId: 'wf1', storyId: 's1' }))
  })
  it('PATCH approve — approvedBy 누락이면 400', async () => {
    const app = await appWith({ approve: vi.fn() })
    const res = await app.inject({ method: 'PATCH', url: '/oracles/o1/approve', payload: {} })
    expect(res.statusCode).toBe(400)
  })
  it('PATCH approve — 미존재(null)면 404', async () => {
    const app = await appWith({ approve: vi.fn().mockResolvedValue(null) })
    const res = await app.inject({ method: 'PATCH', url: '/oracles/o1/approve', payload: { approvedBy: 'h1' } })
    expect(res.statusCode).toBe(404)
  })
  it('PATCH approve — 성공이면 200·eventId 반환', async () => {
    const app = await appWith({ approve: vi.fn().mockResolvedValue({ eventId: 'e1' }) })
    const res = await app.inject({ method: 'PATCH', url: '/oracles/o1/approve', payload: { approvedBy: 'h1' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, eventId: 'e1' })
  })
  it('repo 미주입이면 GET은 빈 목록', async () => {
    const app = Fastify(); await app.register(oracleRoute, {})
    const res = await app.inject({ method: 'GET', url: '/workflows/wf1/oracles' })
    expect(res.json()).toEqual({ items: [] })
  })
})
