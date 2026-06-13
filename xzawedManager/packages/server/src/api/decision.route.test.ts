import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { decisionRoute } from './decision.route.js'

function app(decisionRepo?: unknown) {
  const f = Fastify()
  return decisionRoute(f, decisionRepo ? { decisionRepo: decisionRepo as never } : {}).then(() => f)
}
describe('decisionRoute (P6)', () => {
  it('fix_reverify → recordDecision(routedTo impl) 200', async () => {
    const recordDecision = vi.fn().mockResolvedValue({ eventId: 'e1' })
    const getRequest = vi.fn().mockResolvedValue({ requestId: 'r1', status: 'PENDING' })
    const f = await app({ recordDecision, getRequest })
    const res = await f.inject({ method: 'POST', url: '/workflows/wf-1/decisions/r1/decision', payload: { decidedBy: 'po', choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(200)
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1', choice: 'fix_reverify', routedTo: 'impl', decidedBy: 'po' }))
  })
  it('미존재 요청 → 404', async () => {
    const f = await app({ recordDecision: vi.fn(), getRequest: vi.fn().mockResolvedValue(null) })
    const res = await f.inject({ method: 'POST', url: '/workflows/wf-1/decisions/none/decision', payload: { decidedBy: 'po', choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(404)
  })
  it('비-PENDING(recordDecision null) → 409', async () => {
    const f = await app({ recordDecision: vi.fn().mockResolvedValue(null), getRequest: vi.fn().mockResolvedValue({ requestId: 'r1', status: 'RESOLVED' }) })
    const res = await f.inject({ method: 'POST', url: '/workflows/wf-1/decisions/r1/decision', payload: { decidedBy: 'po', choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(409)
  })
  it('잘못된 choice → 400', async () => {
    const f = await app({ recordDecision: vi.fn(), getRequest: vi.fn() })
    const res = await f.inject({ method: 'POST', url: '/workflows/wf-1/decisions/r1/decision', payload: { decidedBy: 'po', choice: 'bogus' } })
    expect(res.statusCode).toBe(400)
  })
  it('repo 없으면 503', async () => {
    const f = await app()
    const res = await f.inject({ method: 'POST', url: '/workflows/wf-1/decisions/r1/decision', payload: { decidedBy: 'po', choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(503)
  })
})
