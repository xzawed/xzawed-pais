import type { FastifyReply } from 'fastify'
import type { Pool } from 'pg'
import { ProjectRepo, type Project } from '../projects/project.repo.js'

export async function assertProjectOwner(
  userId: string,
  projectId: string,
  pool: Pool,
  reply: FastifyReply
): Promise<Project | false> {
  const repo = new ProjectRepo(pool)
  const project = await repo.findByIdAndUser(projectId, userId)
  if (!project) {
    await reply.status(404).send({ error: 'Project not found' })
    return false
  }
  return project
}
