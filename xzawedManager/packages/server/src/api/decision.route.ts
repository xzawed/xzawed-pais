import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { DecisionRepo } from '../db/decision.repo.js'
import type { HumanDecision } from '../db/decision.types.js'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

interface DecisionRouteOptions {
  decisionRepo?: Pick<DecisionRepo, 'recordDecision' | 'getRequest' | 'pendingByProject'>
  authHook?: RouteHook
}

const BodySchema = z.object({
  decidedBy: z.string().min(1),
  choice: z.enum(['fix_reverify', 'spec_fix', 'accept_known', 'reject']),
  justification: z.string().optional(),
})

const CHOICE_TO_ROUTED: Record<z.infer<typeof BodySchema>['choice'], NonNullable<HumanDecision['routedTo']>> = {
  fix_reverify: 'impl',
  spec_fix: 'task',
  accept_known: 'gate_override',
  reject: 'saga_rollback',
}

/** 사람 결정 제출 라우트. GET pending은 open read; 쓰기는 authHook(서비스 JWT) 설정 시 보호. repo 없으면 503/빈 목록. */
export async function decisionRoute(app: FastifyInstance, opts: DecisionRouteOptions): Promise<void> {
  const writePre = opts.authHook ? [opts.authHook] : []

  // 프로젝트 스코프 pending 조회(open read — knowledge/oracle GET 대칭·플러그인 등록 게이트가 보호).
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/decisions/pending',
    async (req) => {
      if (!opts.decisionRepo) return { items: [] }
      const items = await opts.decisionRepo.pendingByProject(req.params.projectId)
      return { items }
    },
  )

  app.post<{ Params: { projectId: string; requestId: string }; Body: unknown }>(
    '/projects/:projectId/decisions/:requestId/decision',
    { preHandler: writePre },
    async (req, reply) => {
      if (!opts.decisionRepo) return reply.code(503).send({ error: 'decision repository unavailable' })
      const parsed = BodySchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'invalid decision', detail: parsed.error.issues })
      const { projectId, requestId } = req.params
      const existing = await opts.decisionRepo.getRequest(requestId)
      // IDOR 게이트(fail-close): 결정 요청이 URL의 projectId에 속하지 않으면 404(존재 오라클 회피).
      if (!existing || existing.projectId !== projectId) return reply.code(404).send({ error: 'decision request not found' })
      const { decidedBy, choice, justification } = parsed.data
      const res = await opts.decisionRepo.recordDecision({
        decisionId: `${requestId}:${choice}`,
        requestId,
        decidedBy,
        choice,
        routedTo: CHOICE_TO_ROUTED[choice],
        ...(justification !== undefined && { justification }),
      })
      if (!res) return reply.code(409).send({ error: 'decision request not pending' })
      return reply.code(200).send({ ok: true, eventId: res.eventId })
    },
  )
}
