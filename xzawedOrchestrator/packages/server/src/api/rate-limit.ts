import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'

/**
 * @fastify/rate-limit를 이 플러그인 스코프에 등록한다(global:false — `config.rateLimit`가 있는 라우트만 제한).
 * auth·sessions 라우트가 동일한 429 응답 형태를 공유하도록 단일출처화(CPD0). 각 register 스코프는 독립 인스턴스라
 * 두 라우트 모듈에서 각각 호출해도 충돌하지 않는다. 키는 기본(IP) — rate-limit onRequest가 auth preHandler보다
 * 먼저 실행돼 authUser가 아직 없으므로 per-user 키잉은 불가(IP 키잉이 DoS/비용 보호에 충분).
 */
export async function registerLocalRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many requests, please try again later',
    }),
  })
}
