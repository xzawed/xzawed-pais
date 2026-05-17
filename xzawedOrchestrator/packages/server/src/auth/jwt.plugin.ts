import jwtPlugin from '@fastify/jwt'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

export async function registerJwt(app: FastifyInstance, secret: string): Promise<void> {
  await app.register(jwtPlugin, { secret })
}

const ERROR_MESSAGES: Record<string, string> = {
  FST_JWT_NO_AUTHORIZATION_IN_HEADER: 'Missing token',
  FST_JWT_AUTHORIZATION_TOKEN_EXPIRED: 'Token expired',
}

export async function verifyServiceToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await req.jwtVerify().catch(async (err: unknown) => {
    const code = (err as { code?: string }).code ?? ''
    await reply.status(401).send({ error: ERROR_MESSAGES[code] ?? 'Invalid token' })
  })
}
