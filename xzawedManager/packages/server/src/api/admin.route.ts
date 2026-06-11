import { z } from 'zod'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { redriveDlq, DlqReasonSchema, type DlqRedis } from '@xzawed/agent-streams'
import { getRedisClient } from '../streams/redis.client.js'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

export interface AdminRouteOptions {
  redisUrl: string
  /** 설정 시 운영 라우트(redrive)에 적용(서비스 JWT). 미설정이면 개방(하위호환). */
  authHook?: RouteHook
  /** 테스트 주입용 — 기본은 공유 ioredis 클라이언트. */
  getRedis?: () => DlqRedis
}

const RedriveBodySchema = z.object({
  // DLQ를 드레인할 원 스트림(예: 'manager:dispatched:main'). `{sourceStream}:dlq`를 읽어 재발행.
  sourceStream: z.string().min(1).max(512),
  /** 한 번에 재처리할 최대 엔트리 수(1~1000). 미지정 시 redrive 기본(100). */
  count: z.number().int().positive().max(1000).optional(),
  /** 이 reason만 재처리(미지정 시 전부). invalid_schema 무한 재발행 루프 회피용. */
  reason: DlqReasonSchema.optional(),
})

/**
 * 운영 라우트. `POST /api/admin/dlq/redrive` — 격리된 DLQ 메시지를 원 스트림으로 되돌린다(redriveDlq).
 * 멱등 마커 선삭제→재발행→DLQ 제거. 쓰기/부수효과 라우트라 authHook 설정 시 서비스 JWT로 보호.
 */
export async function adminRoute(app: FastifyInstance, opts: AdminRouteOptions): Promise<void> {
  const preHandler = opts.authHook ? [opts.authHook] : []
  const getRedis = opts.getRedis ?? (() => getRedisClient(opts.redisUrl) as unknown as DlqRedis)

  app.post<{ Body: unknown }>(
    '/api/admin/dlq/redrive',
    { preHandler },
    async (req, reply) => {
      const parsed = RedriveBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid request body', detail: parsed.error.issues })
      }
      const { sourceStream, count, reason } = parsed.data
      const result = await redriveDlq(getRedis(), sourceStream, {
        ...(count !== undefined && { count }),
        ...(reason !== undefined && { reason }),
      })
      return reply.code(200).send(result)
    },
  )
}
