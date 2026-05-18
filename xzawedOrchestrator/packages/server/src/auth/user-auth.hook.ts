import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken, type AccessTokenPayload } from './tokens.js'

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AccessTokenPayload
  }
}

export function makeUserAuthHook(userJwtSecret: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      await reply.status(401).send({ error: 'Missing token' })
      return
    }
    const token = header.slice(7)
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
