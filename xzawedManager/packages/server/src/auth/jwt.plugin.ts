import jwtPlugin from '@fastify/jwt'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

export async function registerJwt(app: FastifyInstance, secret: string): Promise<void> {
  await app.register(jwtPlugin, { secret })
}

export async function verifyServiceToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify()
  } catch {
    await reply.status(401).send({ error: 'Unauthorized' })
  }
}
