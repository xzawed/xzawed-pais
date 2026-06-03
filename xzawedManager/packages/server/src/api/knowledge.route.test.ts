import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { knowledgeRoute } from './knowledge.route.js'
import { registerJwt, verifyServiceToken } from '../auth/jwt.plugin.js'

async function build(repo: unknown) {
  const app = Fastify()
  await app.register(knowledgeRoute, { knowledgeRepo: repo as never })
  return app
}

/** SERVICE_JWT 인증이 켜진 구성(authHook 주입). 토큰 발급은 app.jwt.sign으로. */
async function buildWithAuth(repo: unknown) {
  const app = Fastify()
  await registerJwt(app, 'a'.repeat(32))
  await app.register(knowledgeRoute, { knowledgeRepo: repo as never, authHook: verifyServiceToken })
  return app
}

describe('knowledgeRoute', () => {
  it('repo가 있으면 recentByProject 결과를 반환한다', async () => {
    const repo = { recentByProject: vi.fn().mockResolvedValue([{ id: 1, content: 'a', sourceAgent: 'planner', createdAt: 't' }]) }
    const app = await build(repo)
    const res = await app.inject({ method: 'GET', url: '/projects/p1/knowledge' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [{ id: 1, content: 'a', sourceAgent: 'planner', createdAt: 't' }] })
    expect(repo.recentByProject).toHaveBeenCalledWith('p1', 50, undefined, undefined, undefined)
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
    expect(repo.recentByProject).toHaveBeenCalledWith('p1', 200, undefined, undefined, undefined)
    await app.close()
  })

  it('q 쿼리를 trim해 검색어로 전달한다', async () => {
    const repo = { recentByProject: vi.fn().mockResolvedValue([]) }
    const app = await build(repo)
    await app.inject({ method: 'GET', url: '/projects/p1/knowledge?q=%20stripe%20' })
    expect(repo.recentByProject).toHaveBeenCalledWith('p1', 50, 'stripe', undefined, undefined)
    await app.close()
  })

  it('source 쿼리를 trim해 산출 에이전트 필터로 전달한다', async () => {
    const repo = { recentByProject: vi.fn().mockResolvedValue([]) }
    const app = await build(repo)
    await app.inject({ method: 'GET', url: '/projects/p1/knowledge?source=%20security_audit%20' })
    expect(repo.recentByProject).toHaveBeenCalledWith('p1', 50, undefined, 'security_audit', undefined)
    await app.close()
  })

  it('category 쿼리를 trim해 의미 분류 필터로 전달한다', async () => {
    const repo = { recentByProject: vi.fn().mockResolvedValue([]) }
    const app = await build(repo)
    await app.inject({ method: 'GET', url: '/projects/p1/knowledge?category=%20decision%20' })
    expect(repo.recentByProject).toHaveBeenCalledWith('p1', 50, undefined, undefined, 'decision')
    await app.close()
  })

  it('빈 q는 undefined로 전달한다(전체 조회)', async () => {
    const repo = { recentByProject: vi.fn().mockResolvedValue([]) }
    const app = await build(repo)
    await app.inject({ method: 'GET', url: '/projects/p1/knowledge?q=%20%20' })
    expect(repo.recentByProject).toHaveBeenCalledWith('p1', 50, undefined, undefined, undefined)
    await app.close()
  })

  describe('PATCH /projects/:projectId/knowledge/:id', () => {
    it('정상 갱신 시 200 {ok:true}이고 updateById에 id·content·category를 전달한다', async () => {
      const repo = { updateById: vi.fn().mockResolvedValue(true) }
      const app = await build(repo)
      const res = await app.inject({
        method: 'PATCH', url: '/projects/p1/knowledge/5',
        payload: { content: '  수정된 내용  ', category: 'rule' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
      expect(repo.updateById).toHaveBeenCalledWith('p1', 5, '수정된 내용', 'rule')
      await app.close()
    })

    it('category가 빈 문자열이면 null(분류 해제)로 전달한다', async () => {
      const repo = { updateById: vi.fn().mockResolvedValue(true) }
      const app = await build(repo)
      await app.inject({
        method: 'PATCH', url: '/projects/p1/knowledge/5',
        payload: { content: '내용', category: '   ' },
      })
      expect(repo.updateById).toHaveBeenCalledWith('p1', 5, '내용', null)
      await app.close()
    })

    it('category가 없으면 null(분류 해제)로 전달한다', async () => {
      const repo = { updateById: vi.fn().mockResolvedValue(true) }
      const app = await build(repo)
      await app.inject({ method: 'PATCH', url: '/projects/p1/knowledge/5', payload: { content: '내용' } })
      expect(repo.updateById).toHaveBeenCalledWith('p1', 5, '내용', null)
      await app.close()
    })

    it('content가 공백뿐이면 400이고 updateById를 호출하지 않는다', async () => {
      const repo = { updateById: vi.fn() }
      const app = await build(repo)
      const res = await app.inject({
        method: 'PATCH', url: '/projects/p1/knowledge/5', payload: { content: '   ' },
      })
      expect(res.statusCode).toBe(400)
      expect(repo.updateById).not.toHaveBeenCalled()
      await app.close()
    })

    it('content가 없으면 400이고 updateById를 호출하지 않는다', async () => {
      const repo = { updateById: vi.fn() }
      const app = await build(repo)
      const res = await app.inject({ method: 'PATCH', url: '/projects/p1/knowledge/5', payload: {} })
      expect(res.statusCode).toBe(400)
      expect(repo.updateById).not.toHaveBeenCalled()
      await app.close()
    })

    it('id가 비숫자면 400이고 updateById를 호출하지 않는다', async () => {
      const repo = { updateById: vi.fn() }
      const app = await build(repo)
      const res = await app.inject({
        method: 'PATCH', url: '/projects/p1/knowledge/abc', payload: { content: '내용' },
      })
      expect(res.statusCode).toBe(400)
      expect(repo.updateById).not.toHaveBeenCalled()
      await app.close()
    })

    it('updateById가 false면 404(없음·타 프로젝트 id)', async () => {
      const repo = { updateById: vi.fn().mockResolvedValue(false) }
      const app = await build(repo)
      const res = await app.inject({
        method: 'PATCH', url: '/projects/p1/knowledge/999', payload: { content: '내용' },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('repo가 없으면 503', async () => {
      const app = await build(undefined)
      const res = await app.inject({
        method: 'PATCH', url: '/projects/p1/knowledge/5', payload: { content: '내용' },
      })
      expect(res.statusCode).toBe(503)
      await app.close()
    })
  })

  describe('DELETE /projects/:projectId/knowledge/:id', () => {
    it('정상 삭제 시 204 No Content이고 deleteById에 id를 전달한다', async () => {
      const repo = { deleteById: vi.fn().mockResolvedValue(true) }
      const app = await build(repo)
      const res = await app.inject({ method: 'DELETE', url: '/projects/p1/knowledge/5' })
      expect(res.statusCode).toBe(204)
      expect(res.body).toBe('')
      expect(repo.deleteById).toHaveBeenCalledWith('p1', 5)
      await app.close()
    })

    it('id가 비숫자면 400이고 deleteById를 호출하지 않는다', async () => {
      const repo = { deleteById: vi.fn() }
      const app = await build(repo)
      const res = await app.inject({ method: 'DELETE', url: '/projects/p1/knowledge/abc' })
      expect(res.statusCode).toBe(400)
      expect(repo.deleteById).not.toHaveBeenCalled()
      await app.close()
    })

    it('deleteById가 false면 404(없음·타 프로젝트 id)', async () => {
      const repo = { deleteById: vi.fn().mockResolvedValue(false) }
      const app = await build(repo)
      const res = await app.inject({ method: 'DELETE', url: '/projects/p1/knowledge/999' })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('repo가 없으면 503', async () => {
      const app = await build(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/projects/p1/knowledge/5' })
      expect(res.statusCode).toBe(503)
      await app.close()
    })
  })

  describe('쓰기 경로 인증(authHook 설정 시)', () => {
    it('PATCH는 토큰 없으면 401이고 updateById를 호출하지 않는다', async () => {
      const repo = { updateById: vi.fn() }
      const app = await buildWithAuth(repo)
      const res = await app.inject({
        method: 'PATCH', url: '/projects/p1/knowledge/5', payload: { content: '내용' },
      })
      expect(res.statusCode).toBe(401)
      expect(repo.updateById).not.toHaveBeenCalled()
      await app.close()
    })

    it('PATCH는 유효한 서비스 토큰이면 통과해 updateById를 호출한다', async () => {
      const repo = { updateById: vi.fn().mockResolvedValue(true) }
      const app = await buildWithAuth(repo)
      const token = app.jwt.sign({ svc: 'orchestrator' })
      const res = await app.inject({
        method: 'PATCH', url: '/projects/p1/knowledge/5',
        headers: { authorization: `Bearer ${token}` }, payload: { content: '내용' },
      })
      expect(res.statusCode).toBe(200)
      expect(repo.updateById).toHaveBeenCalledWith('p1', 5, '내용', null)
      await app.close()
    })

    it('DELETE는 토큰 없으면 401이고 deleteById를 호출하지 않는다', async () => {
      const repo = { deleteById: vi.fn() }
      const app = await buildWithAuth(repo)
      const res = await app.inject({ method: 'DELETE', url: '/projects/p1/knowledge/5' })
      expect(res.statusCode).toBe(401)
      expect(repo.deleteById).not.toHaveBeenCalled()
      await app.close()
    })

    it('DELETE는 유효한 서비스 토큰이면 통과해 deleteById를 호출한다', async () => {
      const repo = { deleteById: vi.fn().mockResolvedValue(true) }
      const app = await buildWithAuth(repo)
      const token = app.jwt.sign({ svc: 'orchestrator' })
      const res = await app.inject({
        method: 'DELETE', url: '/projects/p1/knowledge/5',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(204)
      expect(repo.deleteById).toHaveBeenCalledWith('p1', 5)
      await app.close()
    })

    it('GET(읽기)은 authHook이 있어도 토큰 없이 개방 유지', async () => {
      const repo = { recentByProject: vi.fn().mockResolvedValue([]) }
      const app = await buildWithAuth(repo)
      const res = await app.inject({ method: 'GET', url: '/projects/p1/knowledge' })
      expect(res.statusCode).toBe(200)
      expect(repo.recentByProject).toHaveBeenCalled()
      await app.close()
    })
  })

  describe('GET ?deleted=true (휴지통)', () => {
    it('deletedByProject 결과를 반환한다', async () => {
      const repo = { deletedByProject: vi.fn().mockResolvedValue([{ id: 3, content: 'x', sourceAgent: 'planner', createdAt: 't' }]) }
      const app = await build(repo)
      const res = await app.inject({ method: 'GET', url: '/projects/p1/knowledge?deleted=true' })
      expect(res.statusCode).toBe(200)
      expect(repo.deletedByProject).toHaveBeenCalledWith('p1', 50)
      expect(res.json()).toEqual({ items: [{ id: 3, content: 'x', sourceAgent: 'planner', createdAt: 't' }] })
      await app.close()
    })

    it('deleted 미지정이면 recentByProject(활성)만 조회한다', async () => {
      const repo = { recentByProject: vi.fn().mockResolvedValue([]), deletedByProject: vi.fn() }
      const app = await build(repo)
      await app.inject({ method: 'GET', url: '/projects/p1/knowledge' })
      expect(repo.recentByProject).toHaveBeenCalled()
      expect(repo.deletedByProject).not.toHaveBeenCalled()
      await app.close()
    })
  })

  describe('POST /:id/restore', () => {
    it('복구 성공 시 200 {ok}이고 restoreById에 id를 전달한다', async () => {
      const repo = { restoreById: vi.fn().mockResolvedValue(true) }
      const app = await build(repo)
      const res = await app.inject({ method: 'POST', url: '/projects/p1/knowledge/5/restore' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
      expect(repo.restoreById).toHaveBeenCalledWith('p1', 5)
      await app.close()
    })

    it('restoreById가 false면 404(없음·삭제 안 된 행)', async () => {
      const repo = { restoreById: vi.fn().mockResolvedValue(false) }
      const app = await build(repo)
      const res = await app.inject({ method: 'POST', url: '/projects/p1/knowledge/999/restore' })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('id가 비숫자면 400이고 restoreById를 호출하지 않는다', async () => {
      const repo = { restoreById: vi.fn() }
      const app = await build(repo)
      const res = await app.inject({ method: 'POST', url: '/projects/p1/knowledge/abc/restore' })
      expect(res.statusCode).toBe(400)
      expect(repo.restoreById).not.toHaveBeenCalled()
      await app.close()
    })

    it('repo가 없으면 503', async () => {
      const app = await build(undefined)
      const res = await app.inject({ method: 'POST', url: '/projects/p1/knowledge/5/restore' })
      expect(res.statusCode).toBe(503)
      await app.close()
    })

    it('authHook 설정 시 토큰 없으면 401이고 restoreById를 호출하지 않는다', async () => {
      const repo = { restoreById: vi.fn() }
      const app = await buildWithAuth(repo)
      const res = await app.inject({ method: 'POST', url: '/projects/p1/knowledge/5/restore' })
      expect(res.statusCode).toBe(401)
      expect(repo.restoreById).not.toHaveBeenCalled()
      await app.close()
    })
  })
})
