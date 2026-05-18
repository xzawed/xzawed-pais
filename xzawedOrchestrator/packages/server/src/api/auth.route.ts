import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { UserRepo, toPublic } from '../auth/user.repo.js'
import { RefreshRepo } from '../auth/refresh.repo.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { issueAccessToken, issueRefreshToken } from '../auth/tokens.js'
import { makeUserAuthHook } from '../auth/user-auth.hook.js'

interface AuthRoutesConfig {
  pool: Pool
  userJwtSecret: string
}

export async function authRoutes(
  app: FastifyInstance,
  config: AuthRoutesConfig
): Promise<void> {
  const { pool, userJwtSecret } = config
  const users = new UserRepo(pool)
  const refreshes = new RefreshRepo(pool)
  const authHook = makeUserAuthHook(userJwtSecret)

  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    '/auth/register',
    async (req, reply) => {
      const { email, password, displayName } = req.body
      if (!email || !password) {
        return reply.status(400).send({ error: 'email and password are required' })
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
    async (req, reply) => {
      const { refreshToken } = req.body
      if (!refreshToken) return reply.status(400).send({ error: 'refreshToken is required' })

      const record = await refreshes.findValid(refreshToken)
      if (!record) return reply.status(401).send({ error: 'Invalid or expired refresh token' })

      const user = await users.findById(record.userId)
      if (!user) return reply.status(401).send({ error: 'User not found' })

      // Refresh token rotation: revoke old, issue new
      await refreshes.revoke(record.id)
      const accessToken = issueAccessToken(
        { sub: user.id, email: user.email, displayName: user.displayName },
        userJwtSecret
      )
      const { token: newRefreshToken, hash, expiresAt } = issueRefreshToken()
      await refreshes.create(user.id, hash, expiresAt, req.headers['user-agent'])

      return reply.send({ accessToken, refreshToken: newRefreshToken })
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
