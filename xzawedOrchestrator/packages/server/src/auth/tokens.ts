import jwt from 'jsonwebtoken'
import { createHash, randomBytes } from 'node:crypto'

export interface AccessTokenPayload {
  sub: string
  email: string
  displayName: string | null
  /** G11 Slice 1: 소속 테넌트 신원(모델 C). enforcement 0 — 아직 어떤 쿼리도 필터하지 않는다.
   *  optional: orgId 없는 레거시 토큰(백필 전 발급)도 verify 통과(하위호환). */
  orgId?: string | null
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
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn } as jwt.SignOptions)
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as AccessTokenPayload
}

const REFRESH_TOKEN_TTL_MS = Number(process.env.REFRESH_TOKEN_TTL_MS ?? String(30 * 24 * 60 * 60 * 1000))

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function issueRefreshToken(): IssuedRefreshToken {
  const token = randomBytes(48).toString('base64url')
  const hash = sha256Hex(token)
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
  return { token, hash, expiresAt }
}
