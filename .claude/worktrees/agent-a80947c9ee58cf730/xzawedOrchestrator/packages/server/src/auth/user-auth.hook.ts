import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken, type AccessTokenPayload } from './tokens.js'

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AccessTokenPayload
  }
}

function extractBearerToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  const proto = req.headers['sec-websocket-protocol']
  const protoStr = Array.isArray(proto) ? proto[0] : proto
  if (protoStr?.startsWith('bearer.')) return protoStr.slice(7)
  return null
}

export function makeUserAuthHook(userJwtSecret: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = extractBearerToken(req)
    if (!token) {
      await reply.status(401).send({ error: 'Missing token' })
      return
    }
    try {
      req.authUser = verifyAccessToken(token, userJwtSecret)
    } catch (err) {
      const name = (err as { name?: string }).name
      if (name === 'TokenExpiredError') {
        await reply.status(401).send({ error: 'Token expired' })
      } else {
        await reply.status(401).send({ error: 'Invalid token' })
      }
    }
  }
}
