import jwtPlugin from '@fastify/jwt'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

export async function registerJwt(app: FastifyInstance, secret: string): Promise<void> {
  await app.register(jwtPlugin, {
    secret,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  })
}

export async function verifyServiceToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify()
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
      await reply.status(401).send({ error: 'Missing token' })
    } else if (code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
      await reply.status(401).send({ error: 'Token expired' })
    } else {
      await reply.status(401).send({ error: 'Invalid token' })
    }
  }
}
