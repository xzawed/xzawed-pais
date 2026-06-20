import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

interface DecisionRoutesConfig {
  managerUrl: string
  /** 설정 시 제출(POST)에 사용자 JWT를 요구한다. GET(읽기)은 항상 개방. */
  userAuthHook?: RouteHook
  /** 설정 시 Manager 호출에 실을 서비스 토큰을 발급한다(서비스 간 인증). */
  signServiceToken?: () => string
}

/** Manager 호출용 헤더 — 서비스 토큰이 있으면 Authorization을 덧붙인다. */
function managerWriteHeaders(config: DecisionRoutesConfig, base: Record<string, string>): Record<string, string> {
  if (!config.signServiceToken) return base
  return { ...base, authorization: `Bearer ${config.signServiceToken()}` }
}

/** Manager 결정 엔드포인트 URL 조립(SSRF 방어: 설정값 파싱). */
function buildManagerUrl(config: DecisionRoutesConfig, projectId: string, suffix: string): URL {
  const base = new URL(config.managerUrl)
  return new URL(`/projects/${encodeURIComponent(projectId)}/decisions${suffix}`, base)
}

/** Manager 응답을 상태코드 pass-through로 중계(본문 없으면 상태만). */
async function relayManagerResponse(reply: FastifyReply, res: Response): Promise<FastifyReply> {
  const text = await res.text()
  if (text === '') return reply.status(res.status).send()
  return reply
    .status(res.status)
    .header('content-type', res.headers.get('content-type') ?? 'application/json')
    .send(text)
}

/**
 * 프로젝트 pending 결정 조회/제출을 Manager로 프록시한다(knowledge.route.ts 패턴).
 * - GET: open read·Manager 미응답/오류 시 빈 목록 폴백.
 * - POST: userAuthHook 설정 시 사용자 JWT 필요. decidedBy는 인증 사용자 sub로 권위 주입(client body 무시·M9 비부인).
 */
export async function decisionsRoutes(app: FastifyInstance, config: DecisionRoutesConfig): Promise<void> {
  const writePreHandler = config.userAuthHook ? [config.userAuthHook] : []

  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/decisions/pending',
    async (req) => {
      try {
        const url = buildManagerUrl(config, req.params.projectId, '/pending')
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) return { items: [] }
        return await res.json()
      } catch (err) {
        app.log.warn({ err }, 'decisions proxy failed — returning empty')
        return { items: [] }
      }
    },
  )

  app.post<{ Params: { projectId: string; requestId: string }; Body: { choice?: string; justification?: string } }>(
    '/projects/:projectId/decisions/:requestId/decision',
    { preHandler: writePreHandler },
    async (req, reply) => {
      try {
        // 비부인(M9): 신원은 인증된 사용자 JWT subject — client가 보낸 decidedBy는 절대 신뢰하지 않는다.
        const decidedBy = req.authUser?.sub ?? 'local-user'
        const url = buildManagerUrl(config, req.params.projectId, `/${encodeURIComponent(req.params.requestId)}/decision`)
        const body: Record<string, unknown> = { decidedBy, choice: req.body.choice }
        if (req.body.justification !== undefined) body.justification = req.body.justification
        const res = await fetch(url, {
          method: 'POST',
          headers: managerWriteHeaders(config, { 'content-type': 'application/json' }),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        })
        return await relayManagerResponse(reply, res)
      } catch (err) {
        app.log.warn({ err }, 'decision submit proxy failed')
        return reply.status(502).send({ error: 'manager unreachable' })
      }
    },
  )
}
