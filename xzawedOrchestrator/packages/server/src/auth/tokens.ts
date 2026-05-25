import jwt from 'jsonwebtoken'
import { createHash, randomBytes } from 'node:crypto'

export interface AccessTokenPayload {
  sub: string
  email: string
  displayName: string | null
}

export interface IssuedRefreshToken {
  token: string
  hash: string
  expiresAt: Date
}

export function issueAccessToken(
  payload: AccessTokenPayload,
  secret: string,
  expiresIn = '15m'
): string {
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions)
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as AccessTokenPayload
}

const REFRESH_TOKEN_TTL_MS = Number(process.env.REFRESH_TOKEN_TTL_MS ?? String(30 * 24 * 60 * 60 * 1000))

export function issueRefreshToken(): IssuedRefreshToken {
  const token = randomBytes(48).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
  return { token, hash, expiresAt }
}
