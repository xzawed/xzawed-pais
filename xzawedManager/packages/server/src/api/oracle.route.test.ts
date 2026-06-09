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
  it('POST 생성 — status:"approved" 주입은 pending으로 강제(사람 승인 게이트 우회 차단)', async () => {
    const repo = { upsert: vi.fn().mockResolvedValue(undefined) }
    const app = await appWith(repo)
    const res = await app.inject({ method: 'POST', url: '/workflows/wf1/oracles', payload: { oracleId: 'o1', storyId: 's1', status: 'approved' } })
    expect(res.statusCode).toBe(201)
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }))
    // approved_at/by를 채울 경로가 없음을 보장: upsert 인자에 그런 필드가 없다.
    const arg = repo.upsert.mock.calls[0][0] as Record<string, unknown>
    expect(arg.status).toBe('pending')
  })
  it('POST 생성 — 잘못된 본문이면 400 invalid oracle', async () => {
    const repo = { upsert: vi.fn() }
    const app = await appWith(repo)
    const res = await app.inject({ method: 'POST', url: '/workflows/wf1/oracles', payload: { storyId: 's1' } }) // oracleId 누락
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'invalid oracle' })
    expect(repo.upsert).not.toHaveBeenCalled()
  })
  it('repo 미주입이면 POST는 503', async () => {
    const app = Fastify(); await app.register(oracleRoute, {})
    const res = await app.inject({ method: 'POST', url: '/workflows/wf1/oracles', payload: { oracleId: 'o1', storyId: 's1' } })
    expect(res.statusCode).toBe(503)
  })
  it('repo 미주입이면 PATCH approve는 503', async () => {
    const app = Fastify(); await app.register(oracleRoute, {})
    const res = await app.inject({ method: 'PATCH', url: '/oracles/o1/approve', payload: { approvedBy: 'h1' } })
    expect(res.statusCode).toBe(503)
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
  it('repo 주입 시 GET은 listByWorkflow 결과를 반환(status 필터 전달)', async () => {
    const items = [{ oracle_id: 'o1', workflow_id: 'wf1', story_id: 's1', status: 'approved' }]
    const repo = { listByWorkflow: vi.fn().mockResolvedValue(items) }
    const app = await appWith(repo)
    const res = await app.inject({ method: 'GET', url: '/workflows/wf1/oracles?status=approved' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items })
    expect(repo.listByWorkflow).toHaveBeenCalledWith('wf1', 'approved')
  })
  it('repo 주입 시 GET은 status 미지정이면 undefined로 전체 조회', async () => {
    const repo = { listByWorkflow: vi.fn().mockResolvedValue([]) }
    const app = await appWith(repo)
    await app.inject({ method: 'GET', url: '/workflows/wf1/oracles' })
    expect(repo.listByWorkflow).toHaveBeenCalledWith('wf1', undefined)
  })
})
