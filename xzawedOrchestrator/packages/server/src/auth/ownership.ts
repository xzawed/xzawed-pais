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
 * G11 Slice 2: org 경계 소유권 단언(모델 C). org에 속하지 않는 프로젝트는 404(비노출 = IDOR 방어).
 * 팀(B) 도착 시 org 멤버 전원이 org 프로젝트에 접근하는 토대. 단일 사용자(모델 C)는 assertProjectOwner와 등가.
 */
export async function assertProjectInOrg(
  orgId: string,
  projectId: string,
  pool: Pool,
  reply: FastifyReply
): Promise<Project | false> {
  const repo = new ProjectRepo(pool)
  const project = await repo.findByIdAndOrg(projectId, orgId)
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
    const projectId = (req.params as { projectId?: string }).projectId
    if (!projectId) return
    // G11 Slice 2: orgId claim(Slice 1)이 있으면 org 경계로 게이팅(모델 C). 레거시 토큰(orgId 부재)은
    // user 경계로 폴백(하위호환). 모델 C(1:1 user↔org)라 둘은 등가 — 회귀 0.
    const orgId = req.authUser?.orgId
    const userId = req.authUser?.sub
    if (orgId) {
      await assertProjectInOrg(orgId, projectId, pool, reply)
    } else if (userId) {
      await assertProjectOwner(userId, projectId, pool, reply)
    }
  }
}
