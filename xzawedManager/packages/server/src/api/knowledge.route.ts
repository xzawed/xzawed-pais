import type { FastifyInstance } from 'fastify'
import type { KnowledgeRepo } from '../db/knowledge.repo.js'

interface KnowledgeRouteOptions {
  knowledgeRepo?: KnowledgeRepo
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** 프로젝트 도메인 지식 조회 — 읽기 전용·비인증(민감정보 아님, health와 동일). */
export async function knowledgeRoute(
  app: FastifyInstance,
  opts: KnowledgeRouteOptions,
): Promise<void> {
  app.get<{ Params: { projectId: string }; Querystring: { limit?: string } }>(
    '/projects/:projectId/knowledge',
    async (req) => {
      if (!opts.knowledgeRepo) return { items: [] }
      const parsed = Number.parseInt(req.query.limit ?? String(DEFAULT_LIMIT), 10)
      const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : DEFAULT_LIMIT
      const items = await opts.knowledgeRepo.recentByProject(req.params.projectId, limit)
      return { items }
    },
  )
}
