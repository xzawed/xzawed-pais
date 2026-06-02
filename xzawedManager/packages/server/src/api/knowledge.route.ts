import type { FastifyInstance, FastifyReply } from 'fastify'
import type { KnowledgeRepo } from '../db/knowledge.repo.js'

interface KnowledgeRouteOptions {
  knowledgeRepo?: KnowledgeRepo
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * 변이 라우트(PATCH/DELETE) 공통 가드: repo 미주입(503)·비정수 id(400)를 검사한다.
 * 통과 시 정수 id를 반환하고, 차단 시 reply로 응답한 뒤 null을 반환한다(jscpd 중복 회피).
 */
function parseId(repo: KnowledgeRepo | undefined, rawId: string, reply: FastifyReply): number | null {
  if (!repo) {
    reply.code(503).send({ error: 'knowledge repository unavailable' })
    return null
  }
  if (!/^\d+$/.test(rawId)) {
    reply.code(400).send({ error: 'invalid id' })
    return null
  }
  return Number(rawId)
}

/** 프로젝트 도메인 지식 조회 — 읽기 전용·비인증(민감정보 아님, health와 동일). */
export async function knowledgeRoute(
  app: FastifyInstance,
  opts: KnowledgeRouteOptions,
): Promise<void> {
  app.get<{ Params: { projectId: string }; Querystring: { limit?: string; q?: string; source?: string; category?: string } }>(
    '/projects/:projectId/knowledge',
    async (req) => {
      if (!opts.knowledgeRepo) return { items: [] }
      const parsed = Number.parseInt(req.query.limit ?? String(DEFAULT_LIMIT), 10)
      const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : DEFAULT_LIMIT
      const q = req.query.q?.trim()
      const source = req.query.source?.trim()
      const category = req.query.category?.trim()
      const items = await opts.knowledgeRepo.recentByProject(
        req.params.projectId, limit, q || undefined, source || undefined, category || undefined,
      )
      return { items }
    },
  )

  // 항목 편집 — content·category 갱신. 비인증(GET과 동일). project_id 가드는 repo에서.
  app.patch<{ Params: { projectId: string; id: string }; Body: { content?: string; category?: string } }>(
    '/projects/:projectId/knowledge/:id',
    async (req, reply) => {
      const id = parseId(opts.knowledgeRepo, req.params.id, reply)
      if (id === null) return reply
      const content = req.body?.content?.trim()
      if (!content) return reply.code(400).send({ error: 'content required' })
      // category: 없거나 빈 문자열이면 분류 해제(null), 있으면 그대로.
      const rawCategory = req.body?.category?.trim()
      const category = rawCategory ? rawCategory : null
      const ok = await opts.knowledgeRepo!.updateById(req.params.projectId, id, content, category)
      if (!ok) return reply.code(404).send({ error: 'not found' })
      return reply.code(200).send({ ok: true })
    },
  )

  // 항목 삭제 — 성공 시 본문 없이 204. 비인증(GET과 동일). project_id 가드는 repo에서.
  app.delete<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/knowledge/:id',
    async (req, reply) => {
      const id = parseId(opts.knowledgeRepo, req.params.id, reply)
      if (id === null) return reply
      const ok = await opts.knowledgeRepo!.deleteById(req.params.projectId, id)
      if (!ok) return reply.code(404).send({ error: 'not found' })
      return reply.code(204).send()
    },
  )
}
