import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { decisionRoute } from './decision.route.js'

function app(decisionRepo?: unknown) {
  const f = Fastify()
  return decisionRoute(f, decisionRepo ? { decisionRepo: decisionRepo as never } : {}).then(() => f)
}
const okRepo = (over: Record<string, unknown> = {}) => ({
  recordDecision: vi.fn().mockResolvedValue({ eventId: 'e1' }),
  getRequest: vi.fn().mockResolvedValue({ requestId: 'r1', projectId: 'proj-1', status: 'PENDING' }),
  pendingByProject: vi.fn().mockResolvedValue([{ requestId: 'r1', projectId: 'proj-1' }]),
  ...over,
})

describe('decisionRoute POST (project-scoped)', () => {
  it('fix_reverify → recordDecision(routedTo impl) 200', async () => {
    const repo = okRepo()
    const f = await app(repo)
    const res = await f.inject({ method: 'POST', url: '/projects/proj-1/decisions/r1/decision', payload: { decidedBy: 'po', choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(200)
    expect(repo.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1', choice: 'fix_reverify', routedTo: 'impl', decidedBy: 'po' }))
  })
  it('미존재 요청 → 404', async () => {
    const f = await app(okRepo({ getRequest: vi.fn().mockResolvedValue(null) }))
    const res = await f.inject({ method: 'POST', url: '/projects/proj-1/decisions/none/decision', payload: { decidedBy: 'po', choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(404)
  })
  it('projectId 불일치(IDOR) → 404·recordDecision 미호출', async () => {
    const repo = okRepo({ getRequest: vi.fn().mockResolvedValue({ requestId: 'r1', projectId: 'OTHER', status: 'PENDING' }) })
    const f = await app(repo)
    const res = await f.inject({ method: 'POST', url: '/projects/proj-1/decisions/r1/decision', payload: { decidedBy: 'po', choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(404)
    expect(repo.recordDecision).not.toHaveBeenCalled()
  })
  it('비-PENDING(recordDecision null) → 409', async () => {
    const f = await app(okRepo({ recordDecision: vi.fn().mockResolvedValue(null) }))
    const res = await f.inject({ method: 'POST', url: '/projects/proj-1/decisions/r1/decision', payload: { decidedBy: 'po', choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(409)
  })
  it('잘못된 choice → 400', async () => {
    const f = await app(okRepo())
    const res = await f.inject({ method: 'POST', url: '/projects/proj-1/decisions/r1/decision', payload: { decidedBy: 'po', choice: 'bogus' } })
    expect(res.statusCode).toBe(400)
  })
  it('repo 없으면 503', async () => {
    const f = await app()
    const res = await f.inject({ method: 'POST', url: '/projects/proj-1/decisions/r1/decision', payload: { decidedBy: 'po', choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(503)
  })
})

describe('decisionRoute GET pending (project-scoped)', () => {
  it('pendingByProject → {items} 200', async () => {
    const repo = okRepo()
    const f = await app(repo)
    const res = await f.inject({ method: 'GET', url: '/projects/proj-1/decisions/pending' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [{ requestId: 'r1', projectId: 'proj-1' }] })
    expect(repo.pendingByProject).toHaveBeenCalledWith('proj-1')
  })
  it('repo 없으면 {items:[]}', async () => {
    const f = await app()
    const res = await f.inject({ method: 'GET', url: '/projects/proj-1/decisions/pending' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
  })
})

describe('decisionRoute POST approve (risk_classification)', () => {
  it('approve choice를 수용한다(risk_classification 승인)', async () => {
    const repo = okRepo()
    const f = await app(repo)
    const res = await f.inject({ method: 'POST', url: '/projects/proj-1/decisions/r1/decision', payload: { decidedBy: 'alice', choice: 'approve' } })
    expect(res.statusCode).toBe(200)
    expect(repo.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1', choice: 'approve', routedTo: 'risk_approve', decidedBy: 'alice' }))
  })
})
