import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Pool } from 'pg'
import type { SessionStore } from '../sessions/session.store.js'
import { ProjectRepo } from '../projects/project.repo.js'
import { WorkspaceService } from '../projects/workspace.service.js'

interface InternalRoutesConfig {
  pool: Pool
  authHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  store: SessionStore
}

export async function internalRoutes(
  app: FastifyInstance,
  { pool, authHook, store }: InternalRoutesConfig,
): Promise<void> {
  const workspaceSvc = new WorkspaceService()

  app.post<{
    Params: { id: string }
    Body: {
      name: string
      workspaceType: 'local' | 'github'
      localPath?: string
      repoUrl?: string
      branch?: string
      description?: string
    }
  }>(
    '/internal/sessions/:id/register-project',
    { ...(authHook && { preHandler: authHook }) },
    async (req, reply) => {
      const session = await store.findById(req.params.id)
      if (!session) return reply.status(404).send({ error: 'Session not found' })

      const { name, workspaceType, localPath, repoUrl, branch = 'main', description } = req.body
      const repo = new ProjectRepo(pool)

      const project = await repo.create(session.userId, name, { description })

      let workspacePath: string | undefined
      let status: 'registered' | 'cloning' = 'registered'

      if (workspaceType === 'local') {
        if (!localPath) return reply.status(400).send({ error: 'localPath required' })
        await workspaceSvc.validateLocalPath(localPath)
        workspacePath = localPath
      } else if (workspaceType === 'github') {
        if (!repoUrl) return reply.status(400).send({ error: 'repoUrl required' })
        const parsedUrl = new URL(repoUrl)
        if (parsedUrl.protocol !== 'https:') {
          return reply.status(400).send({ error: 'repoUrl must use https protocol' })
        }
        workspacePath = workspaceSvc.clonePath(project.id)
        void workspaceSvc.cloneRepo(repoUrl, workspacePath, branch).catch((err: unknown) => {
          app.log.error({ err }, 'background git clone failed')
        })
        status = 'cloning'
      }

      await repo.updateWorkspace(project.id, {
        workspaceType,
        localPath,
        repoUrl,
        branch,
        workspacePath,
        pushStrategy: 'push',
      })

      await store.updateProject(req.params.id, project.id)

      return reply.send({ projectId: project.id, workspacePath: workspacePath ?? null, status })
    },
  )

  app.post<{
    Params: { id: string }
    Body: { projectId?: string; name?: string }
  }>(
    '/internal/sessions/:id/switch-project',
    { ...(authHook && { preHandler: authHook }) },
    async (req, reply) => {
      const session = await store.findById(req.params.id)
      if (!session) return reply.status(404).send({ error: 'Session not found' })

      const repo = new ProjectRepo(pool)
      let project: Awaited<ReturnType<typeof repo.findByIdAndUser>> | undefined

      if (req.body.projectId) {
        project = await repo.findByIdAndUser(req.body.projectId, session.userId)
      } else if (req.body.name) {
        const all = await repo.findByUser(session.userId)
        project = all.find((p) => p.name === req.body.name || p.slug === req.body.name)
      }

      if (!project) return reply.status(404).send({ error: 'Project not found' })

      await store.updateProject(req.params.id, project.id)

      return reply.send({
        projectId: project.id,
        name: project.name,
        workspacePath: project.workspace_path ?? null,
      })
    },
  )
}
