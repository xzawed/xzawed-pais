import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ProjectRepo, type ProjectUpdate } from '../projects/project.repo.js'
import { WorkspaceService } from '../projects/workspace.service.js'
import { makeUserAuthHook } from '../auth/user-auth.hook.js'
import { assertProjectOwner } from '../auth/ownership.js'
import { upsertGithubToken, deleteGithubToken } from '../github-tokens/github-token.repo.js'

interface ProjectsRoutesConfig {
  pool: Pool
  userJwtSecret: string
  githubTokenEncryptionKey?: string
}

export async function projectsRoutes(
  app: FastifyInstance,
  config: ProjectsRoutesConfig
): Promise<void> {
  const { pool, userJwtSecret, githubTokenEncryptionKey } = config
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

  // ── GitHub token management ────────────────────────────────────────────────

  app.put<{ Params: { id: string }; Body: { token?: string } }>(
    '/projects/:id/github-token',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const project = await assertProjectOwner(req.authUser.sub, req.params.id, pool, reply)
      if (!project) return
      const { token } = req.body
      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        return reply.status(400).send({ error: 'token is required' })
      }
      if (!githubTokenEncryptionKey) {
        return reply.status(503).send({ error: 'GitHub token storage not configured' })
      }
      await upsertGithubToken(req.params.id, token.trim(), pool, githubTokenEncryptionKey)
      return reply.status(204).send()
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/projects/:id/github-token',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const project = await assertProjectOwner(req.authUser.sub, req.params.id, pool, reply)
      if (!project) return
      await deleteGithubToken(req.params.id, pool)
      return reply.status(204).send()
    }
  )

  app.get<{ Params: { id: string } }>(
    '/projects/:id/github-token/status',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const project = await assertProjectOwner(req.authUser.sub, req.params.id, pool, reply)
      if (!project) return
      const res = await pool.query<{ token_cipher: Buffer }>(
        'SELECT token_cipher FROM project_github_tokens WHERE project_id = $1',
        [req.params.id]
      )
      return reply.send({ exists: res.rows.length > 0 })
    }
  )

  // ── Workspace management ───────────────────────────────────────────────────

  const workspaceSvc = new WorkspaceService()

  app.patch<{
    Params: { id: string }
    Body: {
      workspaceType: 'none' | 'local' | 'github'
      localPath?: string
      repoUrl?: string
      branch?: string
      pushStrategy?: 'push' | 'pr'
    }
  }>(
    '/projects/:id/workspace',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const { id } = req.params
      const { workspaceType, localPath, repoUrl, branch = 'main', pushStrategy = 'push' } = req.body

      const existing = await repo.findByIdAndUser(id, req.authUser.sub)
      if (!existing) return reply.status(404).send({ error: 'Project not found' })

      let workspacePath: string | undefined

      if (workspaceType === 'local') {
        if (!localPath) return reply.status(400).send({ error: 'localPath required' })
        await workspaceSvc.validateLocalPath(localPath)
        workspacePath = localPath
      } else if (workspaceType === 'github') {
        if (!repoUrl) return reply.status(400).send({ error: 'repoUrl required' })
        workspacePath = workspaceSvc.clonePath(id)
        await workspaceSvc.cloneRepo(repoUrl, workspacePath, branch)
      }

      const updated = await repo.updateWorkspace(id, {
        workspaceType,
        localPath,
        repoUrl,
        branch,
        workspacePath,
        pushStrategy,
      })
      return reply.send(updated)
    }
  )

  app.post<{ Params: { id: string } }>(
    '/projects/:id/sync',
    { preHandler: authHook },
    async (req, reply) => {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      const { id } = req.params
      const project = await repo.findByIdAndUser(id, req.authUser.sub)
      if (!project) return reply.status(404).send({ error: 'Project not found' })
      if (project.workspace_type !== 'github') {
        return reply.status(400).send({ error: 'GitHub 타입 프로젝트만 동기화 가능합니다' })
      }
      if (!project.workspace_path) {
        return reply.status(400).send({ error: 'workspace_path가 없습니다' })
      }
      await workspaceSvc.pullRepo(project.workspace_path, project.branch ?? 'main')
      return reply.send({ ok: true })
    }
  )
}
