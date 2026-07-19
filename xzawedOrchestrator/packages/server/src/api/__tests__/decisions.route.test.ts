import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import { decisionsRoutes } from '../decisions.route.js'
import { makeUserAuthHook } from '../../auth/user-auth.hook.js'
import { issueAccessToken } from '../../auth/tokens.js'

afterEach(() => vi.restoreAllMocks())

const USER_SECRET = 'u'.repeat(32)

async function build() {
  const app = Fastify()
  await app.register(decisionsRoutes, { managerUrl: 'http://manager:3001' })
  return app
}
async function buildWithAuth() {
  const app = Fastify()
  await app.register(decisionsRoutes, {
    managerUrl: 'http://manager:3001',
    userAuthHook: makeUserAuthHook(USER_SECRET),
    signServiceToken: () => 'svc-token-xyz',
  })
  return app
}
function userToken(): string {
  return issueAccessToken({ sub: 'po-7', email: 'a@b.c', displayName: null }, USER_SECRET)
}

describe('decisionsRoutes (proxy)', () => {
  it('GET pending: Manager 응답을 프록시', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ items: [{ requestId: 'r1', type: 'defect_brief' }] }),
    } as Response))
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/p1/decisions/pending' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [{ requestId: 'r1', type: 'defect_brief' }] })
    await app.close()
  })

  it('GET pending: Manager 오류/예외 시 빈 목록 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/p1/decisions/pending' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
    await app.close()
  })

  it('GET pending: Manager non-ok이면 빈 목록 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response))
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/p1/decisions/pending' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
    await app.close()
  })

  it('POST submit: decidedBy를 인증 사용자 sub로 주입(body 무시)하고 Manager에 서비스 토큰 전달', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ ok: true, eventId: 'e1' })),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const app = await buildWithAuth()
    const res = await app.inject({
      method: 'POST', url: '/projects/p1/decisions/r1/decision',
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { choice: 'fix_reverify', justification: '재시도', decidedBy: 'ATTACKER' },
    })
    expect(res.statusCode).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const sentBody = JSON.parse(init.body as string)
    expect(sentBody.decidedBy).toBe('po-7')        // JWT subject — client의 'ATTACKER' 무시
    expect(sentBody.choice).toBe('fix_reverify')
    expect(sentBody.justification).toBe('재시도')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer svc-token-xyz')
    const calledUrl = fetchMock.mock.calls[0][0] as URL
    expect(calledUrl.pathname).toBe('/projects/p1/decisions/r1/decision')
    await app.close()
  })

  it('POST submit: 사용자 토큰 없으면 401·Manager 미호출', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const app = await buildWithAuth()
    const res = await app.inject({ method: 'POST', url: '/projects/p1/decisions/r1/decision', payload: { choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    await app.close()
  })

  it('POST submit: AUTH=none(userAuthHook 미설정)이면 decidedBy=local-user', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const app = await build()
    await app.inject({ method: 'POST', url: '/projects/p1/decisions/r1/decision', payload: { choice: 'fix_reverify' } })
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sentBody.decidedBy).toBe('local-user')
    await app.close()
  })

  it('POST submit: Manager non-ok(404)를 그대로 relay', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 404, headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ error: 'decision request not found' })),
    } as Response))
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/projects/p1/decisions/r1/decision', payload: { choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('POST submit: transport 오류 시 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/projects/p1/decisions/r1/decision', payload: { choice: 'fix_reverify' } })
    expect(res.statusCode).toBe(502)
    await app.close()
  })
})

describe('decisionsRoutes 프로젝트 소유권 게이트 (G11 Slice 0·IDOR 폐색)', () => {
  const mockPool = (rows: unknown[]): import('pg').Pool =>
    ({ query: vi.fn().mockResolvedValue({ rows }) }) as unknown as import('pg').Pool
  async function buildOwned(rows: unknown[]) {
    const app = Fastify()
    await app.register(decisionsRoutes, {
      managerUrl: 'http://manager:3001',
      userAuthHook: makeUserAuthHook(USER_SECRET),
      pool: mockPool(rows), // findByIdAndUser가 rows 반환(소유)/빈배열(비소유)
    })
    return app
  }
  const auth = { authorization: `Bearer ${userToken()}` }

  it('비소유 프로젝트 제출 → 404·Manager 미호출(IDOR 차단)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const app = await buildOwned([]) // 소유 프로젝트 없음 → assertProjectOwner 404
    const res = await app.inject({ method: 'POST', url: '/projects/not-mine/decisions/r1/decision', headers: auth, payload: { choice: 'approve' } })
    expect(res.statusCode).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled() // Manager 프록시 도달 전 단락
    await app.close()
  })

  it('소유 프로젝트 제출 → Manager로 프록시(정상 소유자 회귀 0)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const app = await buildOwned([{ id: 'mine', user_id: 'po-7' }]) // po-7 소유
    const res = await app.inject({ method: 'POST', url: '/projects/mine/decisions/r1/decision', headers: auth, payload: { choice: 'approve' } })
    expect(res.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalled() // 소유자는 통과
    await app.close()
  })

  it('미인증 제출 → 401(소유권 게이트 이전 userAuthHook 단락)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const app = await buildOwned([{ id: 'mine', user_id: 'po-7' }])
    const res = await app.inject({ method: 'POST', url: '/projects/mine/decisions/r1/decision', payload: { choice: 'approve' } })
    expect(res.statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    await app.close()
  })
})
