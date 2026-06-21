import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { RiskClassificationRepo } from '../db/risk-classification.repo.js'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

interface RiskRouteOptions {
  riskRepo?: RiskClassificationRepo
  /** 설정 시 쓰기(PATCH)에 적용. */
  authHook?: RouteHook
}

/** 리스크 분류 승인 라우트(N6 — 승인이 risk.approved 발행→wp.risk write-back). 쓰기는 authHook 보호. repo 없으면 503. */
export async function riskRoute(app: FastifyInstance, opts: RiskRouteOptions): Promise<void> {
  const writePre = opts.authHook ? [opts.authHook] : []

  app.patch<{ Params: { workflowId: string }; Body: { approvedBy?: string } }>(
    '/workflows/:workflowId/risk-classification/approve',
    { preHandler: writePre },
    async (req, reply) => {
      if (!opts.riskRepo) return reply.code(503).send({ error: 'risk repository unavailable' })
      const approvedBy = req.body?.approvedBy?.trim()
      if (!approvedBy) return reply.code(400).send({ error: 'approvedBy required' })
      const res = await opts.riskRepo.approve(req.params.workflowId, approvedBy)
      if (!res) return reply.code(404).send({ error: 'risk classification not found or already approved' })
      return reply.code(200).send({ ok: true, eventId: res.eventId })
    },
  )
}
