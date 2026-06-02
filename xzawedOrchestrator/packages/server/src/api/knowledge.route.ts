import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

interface KnowledgeRoutesConfig {
  managerUrl: string
  /** 설정 시 쓰기 경로(PATCH/DELETE)에 사용자 JWT를 요구한다. GET(읽기)은 항상 개방. */
  userAuthHook?: RouteHook
  /** 설정 시 Manager 쓰기 호출에 실을 서비스 토큰을 발급한다(서비스 간 인증). */
  signServiceToken?: () => string
}

/** Manager 쓰기 호출용 헤더 — 서비스 토큰이 있으면 Authorization을 덧붙인다. */
function managerWriteHeaders(config: KnowledgeRoutesConfig, base: Record<string, string>): Record<string, string> {
  if (!config.signServiceToken) return base
  return { ...base, authorization: `Bearer ${config.signServiceToken()}` }
}

/**
 * Manager 위키 엔드포인트 URL을 조립한다.
 * `new URL(config.managerUrl)`로 설정값을 파싱해 SSRF를 방어하고,
 * projectId(+선택적 id)를 경로 세그먼트로 인코딩한다.
 */
function buildManagerUrl(config: KnowledgeRoutesConfig, projectId: string, id?: string): URL {
  const base = new URL(config.managerUrl) // SSRF 방어: 설정값 파싱
  const suffix = id === undefined ? '' : `/${encodeURIComponent(id)}`
  return new URL(`/projects/${encodeURIComponent(projectId)}/knowledge${suffix}`, base)
}

/**
 * Manager 응답을 그대로 중계한다(상태코드 pass-through).
 * 본문이 있으면(200/400/404 JSON) content-type과 함께 전달하고,
 * 비어 있으면(204 No Content) 본문 없이 상태코드만 전달한다.
 */
async function relayManagerResponse(reply: FastifyReply, res: Response): Promise<FastifyReply> {
  const text = await res.text()
  if (text === '') return reply.status(res.status).send()
  return reply
    .status(res.status)
    .header('content-type', res.headers.get('content-type') ?? 'application/json')
    .send(text)
}

/**
 * 위키 지식 조회/편집/삭제를 Manager로 프록시한다. Manager가 자기 DB를 소유하므로 직접 조회 대신 HTTP 프록시.
 * - GET: Manager 미응답/오류 시 빈 목록으로 graceful 폴백(앱 흐름 차단 없음).
 * - PATCH/DELETE: Manager 상태코드(200/204/400/404)를 그대로 pass-through, transport 오류 시 502.
 * 읽기/쓰기 모두 비인증(위키 전체가 비인증 read-only PO 도구).
 */
export async function knowledgeRoutes(
  app: FastifyInstance,
  config: KnowledgeRoutesConfig,
): Promise<void> {
  // 쓰기 경로(PATCH/DELETE)에만 적용. 미설정(기본)이면 개방 유지(하위호환).
  const writePreHandler = config.userAuthHook ? [config.userAuthHook] : []

  app.get<{ Params: { projectId: string }; Querystring: { limit?: string; q?: string; source?: string; category?: string } }>(
    '/projects/:projectId/knowledge',
    async (req) => {
      try {
        const url = buildManagerUrl(config, req.params.projectId)
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

  app.patch<{ Params: { projectId: string; id: string }; Body: { content: string; category?: string } }>(
    '/projects/:projectId/knowledge/:id',
    { preHandler: writePreHandler },
    async (req, reply) => {
      try {
        const url = buildManagerUrl(config, req.params.projectId, req.params.id)
        const res = await fetch(url, {
          method: 'PATCH',
          headers: managerWriteHeaders(config, { 'content-type': 'application/json' }),
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(5000),
        })
        // 상태코드 pass-through: Manager의 200/400/404를 그대로 중계
        return await relayManagerResponse(reply, res)
      } catch (err) {
        app.log.warn({ err }, 'knowledge update proxy failed')
        return reply.status(502).send({ error: 'manager unreachable' })
      }
    },
  )

  app.delete<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/knowledge/:id',
    { preHandler: writePreHandler },
    async (req, reply) => {
      try {
        const url = buildManagerUrl(config, req.params.projectId, req.params.id)
        const res = await fetch(url, {
          method: 'DELETE',
          headers: managerWriteHeaders(config, {}),
          signal: AbortSignal.timeout(5000),
        })
        // 상태코드 pass-through: Manager의 204/400/404를 그대로 중계
        return await relayManagerResponse(reply, res)
      } catch (err) {
        app.log.warn({ err }, 'knowledge delete proxy failed')
        return reply.status(502).send({ error: 'manager unreachable' })
      }
    },
  )
}
