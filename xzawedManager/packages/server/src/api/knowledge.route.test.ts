import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { knowledgeRoute } from './knowledge.route.js'

async function build(repo: unknown) {
  const app = Fastify()
  await app.register(knowledgeRoute, { knowledgeRepo: repo as never })
  return app
}

describe('knowledgeRoute', () => {
  it('repo가 있으면 recentByProject 결과를 반환한다', async () => {
    const repo = { recentByProject: vi.fn().mockResolvedValue([{ content: 'a', sourceAgent: 'planner', createdAt: 't' }]) }
    const app = await build(repo)
    const res = await app.inject({ method: 'GET', url: '/projects/p1/knowledge' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [{ content: 'a', sourceAgent: 'planner', createdAt: 't' }] })
    expect(repo.recentByProject).toHaveBeenCalledWith('p1', 50)
    await app.close()
  })

  it('repo가 없으면 빈 목록', async () => {
    const app = await build(undefined)
    const res = await app.inject({ method: 'GET', url: '/projects/p1/knowledge' })
    expect(res.json()).toEqual({ items: [] })
    await app.close()
  })

  it('limit 쿼리를 상한 200으로 제한한다', async () => {
    const repo = { recentByProject: vi.fn().mockResolvedValue([]) }
    const app = await build(repo)
    await app.inject({ method: 'GET', url: '/projects/p1/knowledge?limit=999' })
    expect(repo.recentByProject).toHaveBeenCalledWith('p1', 200)
    await app.close()
  })
})
