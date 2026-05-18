import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ProjectRepo, type ProjectUpdate } from '../projects/project.repo.js'
import { makeUserAuthHook } from '../auth/user-auth.hook.js'
import { assertProjectOwner } from '../auth/ownership.js'

interface ProjectsRoutesConfig {
  pool: Pool
  userJwtSecret: string
}

export async function projectsRoutes(
  app: FastifyInstance,
  config: ProjectsRoutesConfig
): Promise<void> {
  const { pool, userJwtSecret } = config
  const repo = new ProjectRepo(pool)
  const authHook = makeUserAuthHook(userJwtSecret)

  app.get(
    '/projects',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const projects = await repo.findByUser(req.authUser.sub)
      return reply.send({ projects })
    }
  )

  app.post<{ Body: { name: string; description?: string; githubOwner?: string; githubRepo?: string; githubBranch?: string } }>(
    '/projects',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const { name, description, githubOwner, githubRepo, githubBranch } = req.body
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.status(400).send({ error: 'name is required' })
      }
      const project = await repo.create(req.authUser.sub, name.trim(), {
        description,
        githubOwner,
        githubRepo,
        githubBranch,
      })
      return reply.status(201).send({ project })
    }
  )

  app.get<{ Params: { id: string } }>(
    '/projects/:id',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const project = await assertProjectOwner(req.authUser.sub, req.params.id, pool, reply)
      if (!project) return
      return reply.send({ project })
    }
  )

  app.patch<{ Params: { id: string }; Body: ProjectUpdate }>(
    '/projects/:id',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const existing = await assertProjectOwner(req.authUser.sub, req.params.id, pool, reply)
      if (!existing) return
      const project = await repo.update(req.params.id, req.body)
      return reply.send({ project })
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/projects/:id',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const existing = await assertProjectOwner(req.authUser.sub, req.params.id, pool, reply)
      if (!existing) return
      await repo.delete(req.params.id)
      return reply.status(204).send()
    }
  )
}
