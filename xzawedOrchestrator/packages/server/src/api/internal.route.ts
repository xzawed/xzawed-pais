import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Pool } from 'pg'
import type { SessionStore } from '../sessions/session.store.js'
import { ProjectRepo } from '../projects/project.repo.js'
import { WorkspaceService } from '../projects/workspace.service.js'
import { normalizeWorkspacePath, assertReadableDirectory, WorkspacePathError } from '../projects/workspace-path.js'
import { validateBranchName } from '../projects/branch-validation.js'

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

      try { validateBranchName(branch) } catch {
        return reply.status(400).send({ error: 'Invalid branch name' })
      }

      const repo = new ProjectRepo(pool)

      // **검증이 repo.create() 앞이다.** 뒤에 두면 검증 실패 시 워크스페이스 없는
      // 고아 프로젝트 행이 남고, 세션과도 연결되지 않는다.
      let normalizedLocalPath: string | undefined
      // repoUrl 검사도 create 앞으로 옮겨졌으므로 좁혀진 값을 여기 담아 넘긴다.
      let validatedRepoUrl: string | undefined
      if (workspaceType === 'local') {
        if (!localPath) return reply.status(400).send({ error: 'localPath required' })
        // 응답 형태를 오류 핸들러 배선에 맡기지 않는다 — 하네스에 따라 봉투가 달라진다.
        try {
          normalizedLocalPath = normalizeWorkspacePath(localPath)
          await assertReadableDirectory(normalizedLocalPath)
        } catch (err) {
          if (err instanceof WorkspacePathError) {
            return reply.status(400).send({ error: err.message, reason: err.reason })
          }
          throw err
        }
      } else if (workspaceType === 'github') {
        if (!repoUrl) return reply.status(400).send({ error: 'repoUrl required' })
        const parsedUrl = new URL(repoUrl)
        if (parsedUrl.protocol !== 'https:') {
          return reply.status(400).send({ error: 'repoUrl must use https protocol' })
        }
        validatedRepoUrl = repoUrl
      }

      const project = await repo.create(session.userId, name, { description })

      let workspacePath: string | undefined
      let status: 'registered' | 'cloning' = 'registered'

      if (workspaceType === 'local') {
        workspacePath = normalizedLocalPath
      } else if (workspaceType === 'github' && validatedRepoUrl !== undefined) {
        // clone 목적지는 Layer 1 만 — :61 이 `void cloneRepo(...)` 라 이 시점에 존재하지 않는다.
        workspacePath = normalizeWorkspacePath(workspaceSvc.clonePath(project.id))
        void workspaceSvc.cloneRepo(validatedRepoUrl, workspacePath, branch).catch(async (err: unknown) => {
          app.log.error({ err }, 'background git clone failed')
          await repo.updateWorkspace(project.id, {
            workspaceType,
            localPath: normalizedLocalPath ?? localPath,
            repoUrl,
            branch,
            workspacePath: undefined,
            pushStrategy: 'push',
          }).catch((updateErr: unknown) => {
            app.log.error({ err: updateErr }, 'failed to reset workspace_path after clone failure')
          })
        })
        status = 'cloning'
      }

      await repo.updateWorkspace(project.id, {
        workspaceType,
        localPath: normalizedLocalPath ?? localPath,
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
