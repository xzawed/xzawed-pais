import type { FastifyInstance } from 'fastify'

interface KnowledgeRoutesConfig {
  managerUrl: string
}

/**
 * 위키 지식 조회를 Manager로 프록시한다. Manager가 자기 DB를 소유하므로 직접 조회 대신 HTTP 프록시.
 * Manager 미응답/오류 시 빈 목록으로 graceful 폴백(앱 흐름 차단 없음).
 */
export async function knowledgeRoutes(
  app: FastifyInstance,
  config: KnowledgeRoutesConfig,
): Promise<void> {
  app.get<{ Params: { projectId: string }; Querystring: { limit?: string; q?: string; source?: string; category?: string } }>(
    '/projects/:projectId/knowledge',
    async (req) => {
      try {
        const base = new URL(config.managerUrl) // SSRF 방어: 설정값 파싱
        const url = new URL(`/projects/${encodeURIComponent(req.params.projectId)}/knowledge`, base)
        if (req.query.limit) url.searchParams.set('limit', req.query.limit)
        if (req.query.q) url.searchParams.set('q', req.query.q)
        if (req.query.source) url.searchParams.set('source', req.query.source)
        if (req.query.category) url.searchParams.set('category', req.query.category)
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) return { items: [] }
        return await res.json()
      } catch (err) {
        app.log.warn({ err }, 'knowledge proxy failed — returning empty')
        return { items: [] }
      }
    },
  )
}
