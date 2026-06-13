import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { DecisionRepo } from '../db/decision.repo.js'
import type { HumanDecision } from '../db/decision.types.js'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

interface DecisionRouteOptions {
  decisionRepo?: Pick<DecisionRepo, 'recordDecision' | 'getRequest'>
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

/** 사람 결정 제출 라우트. 쓰기는 authHook(서비스 JWT) 설정 시 보호. repo 없으면 503. */
export async function decisionRoute(app: FastifyInstance, opts: DecisionRouteOptions): Promise<void> {
  const writePre = opts.authHook ? [opts.authHook] : []
  app.post<{ Params: { workflowId: string; requestId: string }; Body: unknown }>(
    '/workflows/:workflowId/decisions/:requestId/decision',
    { preHandler: writePre },
    async (req, reply) => {
      if (!opts.decisionRepo) return reply.code(503).send({ error: 'decision repository unavailable' })
      const parsed = BodySchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'invalid decision', detail: parsed.error.issues })
      const { requestId } = req.params
      const existing = await opts.decisionRepo.getRequest(requestId)
      if (!existing) return reply.code(404).send({ error: 'decision request not found' })
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
