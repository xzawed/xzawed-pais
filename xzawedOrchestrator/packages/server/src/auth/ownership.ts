import type { FastifyReply, FastifyRequest } from 'fastify'
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

/**
 * 프로젝트 소유권 preHandler 팩토리(knowledge·decisions 쓰기 프록시 공유·CPD0·G11 Slice 0).
 * userAuthHook **다음**에 배치한다 — 인증된 사용자가 `:projectId`를 소유하지 않으면 assertProjectOwner가
 * 404를 전송해 Fastify 라이프사이클이 핸들러(Manager 프록시) 전에 단락한다(IDOR 폐색).
 * authUser/projectId 부재 시 무동작(userAuthHook이 선행 401 보장·방어적 skip). pool 주입 시에만 배선.
 */
export function projectOwnershipPreHandler(
  pool: Pool
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (req, reply) => {
    const userId = req.authUser?.sub
    const projectId = (req.params as { projectId?: string }).projectId
    if (!userId || !projectId) return
    await assertProjectOwner(userId, projectId, pool, reply)
  }
}
