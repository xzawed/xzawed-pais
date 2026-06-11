import { z } from 'zod'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { redriveDlq, DlqReasonSchema, type DlqRedis } from '@xzawed/agent-streams'
import { getRedisClient } from '../streams/redis.client.js'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

export interface AdminRouteOptions {
  redisUrl: string
  /**
   * **필수** — 운영 라우트(redrive)는 부수효과(원 스트림 재발행→자율 에이전트 실행 트리거)가 있는 권한
   * 엔드포인트라 인증을 강제한다. open admin endpoint를 만들지 않기 위해 옵셔널이 아니다. 인증을 구성할 수
   * 없는 환경(SERVICE_JWT_SECRET 미설정)에서는 server.ts가 이 라우트를 **아예 등록하지 않는다**(미마운트).
   */
  authHook: RouteHook
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
  const getRedis = opts.getRedis ?? (() => getRedisClient(opts.redisUrl) as unknown as DlqRedis)

  app.post<{ Body: unknown }>(
    '/api/admin/dlq/redrive',
    { preHandler: [opts.authHook] }, // 인증 필수 — authHook은 항상 preHandler로 실행(우회 경로 없음)
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
