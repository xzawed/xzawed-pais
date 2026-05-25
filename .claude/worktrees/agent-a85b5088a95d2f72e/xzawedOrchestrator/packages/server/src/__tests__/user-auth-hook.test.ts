import { describe, it, expect, vi } from 'vitest'
import { makeUserAuthHook } from '../auth/user-auth.hook.js'
import { issueAccessToken } from '../auth/tokens.js'

const SECRET = 'test-secret-key-that-is-long-enough-32ch'

function makeReply() {
  const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockResolvedValue(undefined) }
  return reply
}

function makeReq(headers: Record<string, string>) {
  return { headers, authUser: undefined as unknown }
}

describe('makeUserAuthHook', () => {
  it('Authorization Bearer 헤더로 인증 성공', async () => {
    const hook = makeUserAuthHook(SECRET)
    const token = issueAccessToken({ sub: 'u1', email: 'a@b.com', displayName: null }, SECRET)
    const req = makeReq({ authorization: `Bearer ${token}` })
    const reply = makeReply()
    await hook(req as never, reply as never)
    expect(reply.status).not.toHaveBeenCalled()
    expect((req as { authUser?: { sub: string } }).authUser?.sub).toBe('u1')
  })

  it('Sec-WebSocket-Protocol bearer.<token>으로 WS 인증 성공', async () => {
    const hook = makeUserAuthHook(SECRET)
    const token = issueAccessToken({ sub: 'u2', email: 'b@c.com', displayName: 'WsUser' }, SECRET)
    const req = makeReq({ 'sec-websocket-protocol': `bearer.${token}` })
    const reply = makeReply()
    await hook(req as never, reply as never)
    expect(reply.status).not.toHaveBeenCalled()
    expect((req as { authUser?: { sub: string } }).authUser?.sub).toBe('u2')
  })

  it('토큰 없으면 401 반환', async () => {
    const hook = makeUserAuthHook(SECRET)
    const req = makeReq({})
    const reply = makeReply()
    await hook(req as never, reply as never)
    expect(reply.status).toHaveBeenCalledWith(401)
    expect(reply.send).toHaveBeenCalledWith({ error: 'Missing token' })
  })

  it('만료된 토큰은 401 Token expired 반환', async () => {
    const hook = makeUserAuthHook(SECRET)
    const token = issueAccessToken({ sub: 'u3', email: 'c@d.com', displayName: null }, SECRET, '0s')
    await new Promise((r) => setTimeout(r, 10))
    const req = makeReq({ authorization: `Bearer ${token}` })
    const reply = makeReply()
    await hook(req as never, reply as never)
    expect(reply.status).toHaveBeenCalledWith(401)
    expect(reply.send).toHaveBeenCalledWith({ error: 'Token expired' })
  })
})
