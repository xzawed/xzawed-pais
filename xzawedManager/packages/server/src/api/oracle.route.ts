import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { OracleRepo } from '../db/oracle.repo.js'
import { OracleSchema, ORACLE_PENDING } from '../db/oracle.types.js'

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
      // 생성=pending 강제: 스프레드 후 status를 덮어써 클라이언트가 status:'approved'로 사람 승인 게이트(PATCH /approve)·
      // oracle.approved 이벤트 발행을 우회한 채 곧바로 approved를 영속하는 것을 차단(설계 §4·migration 009 DEFAULT pending).
      const parsed = OracleSchema.safeParse({
        ...(req.body as object),
        workflowId: req.params.workflowId,
        status: ORACLE_PENDING,
      })
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
