import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { issueAccessToken, verifyAccessToken, issueRefreshToken } from '../auth/tokens.js'

const SECRET = 'test-secret-key-that-is-long-enough-32ch'

describe('password', () => {
  it('해시 생성 후 검증 성공', async () => {
    const hash = await hashPassword('mypassword123')
    expect(hash).toMatch(/^\$argon2/)
    await expect(verifyPassword(hash, 'mypassword123')).resolves.toBe(true)
  })

  it('잘못된 비밀번호는 false 반환', async () => {
    const hash = await hashPassword('correct')
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false)
  })
})

describe('tokens', () => {
  it('access token 발급 후 검증', () => {
    const payload = { sub: 'user-123', email: 'a@b.com', displayName: 'Test' }
    const token = issueAccessToken(payload, SECRET)
    const decoded = verifyAccessToken(token, SECRET)
    expect(decoded.sub).toBe('user-123')
    expect(decoded.email).toBe('a@b.com')
  })

  it('잘못된 secret으로 검증 시 에러', () => {
    const token = issueAccessToken({ sub: 'u', email: 'a@b.com', displayName: null }, SECRET)
    expect(() => verifyAccessToken(token, 'wrong-secret')).toThrow()
  })

  it('refresh token은 고유하고 sha256 해시를 포함한다', () => {
    const r1 = issueRefreshToken()
    const r2 = issueRefreshToken()
    expect(r1.token).not.toBe(r2.token)
    expect(r1.hash).not.toBe(r2.hash)
    expect(r1.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(r1.token.length).toBeGreaterThan(30)
  })
})

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? ''
const hasDb = DATABASE_URL !== ''

describe.skipIf(!hasDb)('auth routes integration', () => {
  it.todo('register → login → refresh → logout → me 전체 흐름 (DB 필요)')
})
