import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { createHash } from 'node:crypto'
import rateLimit from '@fastify/rate-limit'
import { UserRepo, toPublic } from '../auth/user.repo.js'
import { RefreshRepo } from '../auth/refresh.repo.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { issueAccessToken, issueRefreshToken } from '../auth/tokens.js'
import { makeUserAuthHook } from '../auth/user-auth.hook.js'

interface AuthRoutesConfig {
  pool: Pool
  userJwtSecret: string
}

function getClientIp(req: { headers: Record<string, string | string[] | undefined>; ip: string }): string {
  const forwarded = req.headers['x-forwarded-for']
  const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return ip?.trim() ?? req.ip
}

export async function authRoutes(
  app: FastifyInstance,
  config: AuthRoutesConfig
): Promise<void> {
  const { pool, userJwtSecret } = config
  const users = new UserRepo(pool)
  const refreshes = new RefreshRepo(pool)
  const authHook = makeUserAuthHook(userJwtSecret)

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => getClientIp(req as Parameters<typeof getClientIp>[0]),
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many requests, please try again later',
    }),
  })

  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const { email, password, displayName } = req.body
      if (!email || !password) {
        return reply.status(400).send({ error: 'email and password are required' })
      }
      if (!EMAIL_RE.test(email)) {
        return reply.status(400).send({ error: 'Invalid email format' })
      }
      if (password.length < 8) {
        return reply.status(400).send({ error: 'password must be at least 8 characters' })
      }

      const existing = await users.findByEmail(email)
      if (existing) return reply.status(409).send({ error: 'Email already registered' })

      const passwordHash = await hashPassword(password)
      const user = await users.create(email, passwordHash, displayName)

      const accessToken = issueAccessToken(
        { sub: user.id, email: user.email, displayName: user.displayName },
        userJwtSecret
      )
      const { token: refreshToken, hash, expiresAt } = issueRefreshToken()
      await refreshes.create(user.id, hash, expiresAt, req.headers['user-agent'])

      return reply.status(201).send({ user: toPublic(user), accessToken, refreshToken })
    }
  )

  app.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password } = req.body
      if (!email || !password) {
        return reply.status(400).send({ error: 'email and password are required' })
      }

      const user = await users.findByEmail(email)
      if (!user) return reply.status(401).send({ error: 'Invalid credentials' })

      const valid = await verifyPassword(user.passwordHash, password)
      if (!valid) return reply.status(401).send({ error: 'Invalid credentials' })

      const accessToken = issueAccessToken(
        { sub: user.id, email: user.email, displayName: user.displayName },
        userJwtSecret
      )
      const { token: refreshToken, hash, expiresAt } = issueRefreshToken()
      await refreshes.create(user.id, hash, expiresAt, req.headers['user-agent'])

      return reply.send({ user: toPublic(user), accessToken, refreshToken })
    }
  )

  app.post<{ Body: { refreshToken: string } }>(
    '/auth/refresh',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { refreshToken } = req.body
      if (!refreshToken) return reply.status(400).send({ error: 'refreshToken is required' })

      const tokenHash = createHash('sha256').update(refreshToken).digest('hex')

      // Refresh token rotation: findValid + revoke + insert in a single transaction
      // SELECT FOR UPDATE prevents concurrent refresh with the same token (TOCTOU)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        const { rows } = await client.query<{ id: string; user_id: string }>(
          `SELECT id, user_id FROM refresh_tokens
           WHERE token_hash = $1 AND expires_at > NOW() AND revoked_at IS NULL
           FOR UPDATE`,
          [tokenHash]
        )
        const record = rows[0]
        if (!record) {
          await client.query('ROLLBACK')
          return reply.status(401).send({ error: 'Invalid or expired refresh token' })
        }

        const user = await users.findById(record.user_id)
        if (!user) {
          await client.query('ROLLBACK')
          return reply.status(401).send({ error: 'User not found' })
        }

        const { token: newRefreshToken, hash, expiresAt } = issueRefreshToken()
        const accessToken = issueAccessToken(
          { sub: user.id, email: user.email, displayName: user.displayName },
          userJwtSecret
        )

        await client.query(
          'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
          [record.id]
        )
        await client.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
           VALUES ($1, $2, $3, $4)`,
          [user.id, hash, expiresAt, req.headers['user-agent'] ?? null]
        )
        await client.query('COMMIT')

        return reply.send({ accessToken, refreshToken: newRefreshToken })
      } catch (txErr) {
        await client.query('ROLLBACK')
        throw txErr
      } finally {
        client.release()
      }
    }
  )

  app.post(
    '/auth/logout',
    { preHandler: authHook },
    async (req, reply) => {
      if (req.authUser) await refreshes.revokeAllForUser(req.authUser.sub)
      return reply.send({ ok: true })
    }
  )

  app.get(
    '/auth/me',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const user = await users.findById(req.authUser.sub)
      if (!user) return reply.status(404).send({ error: 'User not found' })
      return reply.send({ user: toPublic(user) })
    }
  )
}
