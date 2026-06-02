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

  it('q·limit·source·category 쿼리를 Manager URL로 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const app = await build()
    await app.inject({ method: 'GET', url: '/projects/p1/knowledge?q=stripe&limit=10&source=plan_task&category=decision' })
    const calledUrl = fetchMock.mock.calls[0][0] as URL
    expect(calledUrl.searchParams.get('q')).toBe('stripe')
    expect(calledUrl.searchParams.get('limit')).toBe('10')
    expect(calledUrl.searchParams.get('source')).toBe('plan_task')
    expect(calledUrl.searchParams.get('category')).toBe('decision')
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

  it('PATCH: body·content-type·메서드로 Manager URL을 호출하고 200 {ok}을 pass-through 한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const app = await build()
    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/p1/knowledge/42',
      payload: { content: '수정됨', category: 'decision' },
    })
    // Manager 호출 검증: URL·메서드·content-type·body 전달
    const calledUrl = fetchMock.mock.calls[0][0] as URL
    const calledInit = fetchMock.mock.calls[0][1] as RequestInit
    expect(calledUrl.pathname).toBe('/projects/p1/knowledge/42')
    expect(calledInit.method).toBe('PATCH')
    expect((calledInit.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(calledInit.body as string)).toEqual({ content: '수정됨', category: 'decision' })
    // 응답 상태/바디 pass-through
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })

  it('PATCH: Manager non-ok(404)를 그대로 relay 한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ error: 'not found' })),
    } as Response))
    const app = await build()
    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/p1/knowledge/999',
      payload: { content: 'x' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
    await app.close()
  })

  it('PATCH: transport 오류 시 502로 폴백한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const app = await build()
    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/p1/knowledge/42',
      payload: { content: 'x' },
    })
    expect(res.statusCode).toBe(502)
    await app.close()
  })

  it('DELETE: Manager 204를 본문 없이 pass-through 한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      headers: new Headers(),
      text: () => Promise.resolve(''),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const app = await build()
    const res = await app.inject({ method: 'DELETE', url: '/projects/p1/knowledge/42' })
    // Manager 호출 검증: URL·메서드
    const calledUrl = fetchMock.mock.calls[0][0] as URL
    const calledInit = fetchMock.mock.calls[0][1] as RequestInit
    expect(calledUrl.pathname).toBe('/projects/p1/knowledge/42')
    expect(calledInit.method).toBe('DELETE')
    // 204 pass-through, 본문 없음
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    await app.close()
  })

  it('DELETE: Manager non-ok(404)를 그대로 relay 한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ error: 'not found' })),
    } as Response))
    const app = await build()
    const res = await app.inject({ method: 'DELETE', url: '/projects/p1/knowledge/999' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
    await app.close()
  })

  it('DELETE: transport 오류 시 502로 폴백한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const app = await build()
    const res = await app.inject({ method: 'DELETE', url: '/projects/p1/knowledge/42' })
    expect(res.statusCode).toBe(502)
    await app.close()
  })
})
