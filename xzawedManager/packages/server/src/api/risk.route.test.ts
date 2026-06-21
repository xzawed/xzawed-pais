import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { riskRoute } from './risk.route.js'

function build(repo: unknown) {
  const app = Fastify()
  return app.register(riskRoute, { riskRepo: repo as never }).then(() => app)
}

describe('riskRoute PATCH approve', () => {
  it('승인 성공 → 200 {ok, eventId}', async () => {
    const repo = { approve: vi.fn().mockResolvedValue({ eventId: 'ev1' }) }
    const app = await build(repo)
    const res = await app.inject({ method: 'PATCH', url: '/workflows/wf-1/risk-classification/approve', payload: { approvedBy: 'alice' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, eventId: 'ev1' })
    expect(repo.approve).toHaveBeenCalledWith('wf-1', 'alice')
    await app.close()
  })
  it('approvedBy 누락 → 400', async () => {
    const repo = { approve: vi.fn() }
    const app = await build(repo)
    const res = await app.inject({ method: 'PATCH', url: '/workflows/wf-1/risk-classification/approve', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(repo.approve).not.toHaveBeenCalled()
    await app.close()
  })
  it('미존재·이미 승인(approve null) → 404', async () => {
    const repo = { approve: vi.fn().mockResolvedValue(null) }
    const app = await build(repo)
    const res = await app.inject({ method: 'PATCH', url: '/workflows/wf-x/risk-classification/approve', payload: { approvedBy: 'a' } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
  it('repo 없음 → 503', async () => {
    const app = Fastify(); await app.register(riskRoute, {})
    const res = await app.inject({ method: 'PATCH', url: '/workflows/wf/risk-classification/approve', payload: { approvedBy: 'a' } })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})
