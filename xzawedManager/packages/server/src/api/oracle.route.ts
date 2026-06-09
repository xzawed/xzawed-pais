import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { OracleRepo } from '../db/oracle.repo.js'
import { OracleSchema } from '../db/oracle.types.js'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

interface OracleRouteOptions {
  oracleRepo?: OracleRepo
  /** 설정 시 쓰기 경로(POST/PATCH)에만 적용. GET은 항상 개방. */
  authHook?: RouteHook
}

/** Oracle 작성·승인·조회 라우트. 쓰기는 authHook(서비스 JWT) 설정 시 보호. repo 없으면 graceful. */
export async function oracleRoute(app: FastifyInstance, opts: OracleRouteOptions): Promise<void> {
  const writePre = opts.authHook ? [opts.authHook] : []

  app.post<{ Params: { workflowId: string }; Body: unknown }>(
    '/workflows/:workflowId/oracles',
    { preHandler: writePre },
    async (req, reply) => {
      if (!opts.oracleRepo) return reply.code(503).send({ error: 'oracle repository unavailable' })
      const parsed = OracleSchema.safeParse({ ...(req.body as object), workflowId: req.params.workflowId })
      if (!parsed.success) return reply.code(400).send({ error: 'invalid oracle', detail: parsed.error.issues })
      await opts.oracleRepo.upsert(parsed.data)
      return reply.code(201).send({ oracleId: parsed.data.oracleId })
    },
  )

  app.patch<{ Params: { oracleId: string }; Body: { approvedBy?: string } }>(
    '/oracles/:oracleId/approve',
    { preHandler: writePre },
    async (req, reply) => {
      if (!opts.oracleRepo) return reply.code(503).send({ error: 'oracle repository unavailable' })
      const approvedBy = req.body?.approvedBy?.trim()
      if (!approvedBy) return reply.code(400).send({ error: 'approvedBy required' })
      const res = await opts.oracleRepo.approve(req.params.oracleId, approvedBy)
      if (!res) return reply.code(404).send({ error: 'oracle not found or already approved' })
      return reply.code(200).send({ ok: true, eventId: res.eventId })
    },
  )

  app.get<{ Params: { workflowId: string }; Querystring: { status?: string } }>(
    '/workflows/:workflowId/oracles',
    async (req) => {
      if (!opts.oracleRepo) return { items: [] }
      const items = await opts.oracleRepo.listByWorkflow(req.params.workflowId, req.query.status?.trim() || undefined)
      return { items }
    },
  )
}
