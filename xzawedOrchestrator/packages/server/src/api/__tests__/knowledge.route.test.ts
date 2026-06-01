import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import { knowledgeRoutes } from '../knowledge.route.js'

afterEach(() => vi.restoreAllMocks())

async function build() {
  const app = Fastify()
  await app.register(knowledgeRoutes, { managerUrl: 'http://manager:3001' })
  return app
}

describe('knowledgeRoutes (proxy)', () => {
  it('Manager 응답을 프록시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [{ content: 'a', sourceAgent: 'planner', createdAt: 't' }] }),
    } as Response))
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/p1/knowledge' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [{ content: 'a', sourceAgent: 'planner', createdAt: 't' }] })
    await app.close()
  })

  it('Manager 오류(non-ok) 시 빈 목록', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response))
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/p1/knowledge' })
    expect(res.json()).toEqual({ items: [] })
    await app.close()
  })

  it('fetch 예외 시 빈 목록으로 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/p1/knowledge' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
    await app.close()
  })
})
