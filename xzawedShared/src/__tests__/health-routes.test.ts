import { describe, it, expect } from 'vitest'
import { registerHealthRoutes, type HealthRouteRegistrar, type HealthRouteOptions } from '../health/routes.js'
import type { ReadinessProbe } from '../health/readiness.js'

/**
 * 라우트 등록기는 8개 소비처가 공유하는 유일한 사본이다. 여기서 형태가 깨지면
 * 에이전트 7종과 Manager 의 헬스체크가 **동시에** 깨진다.
 *
 * **Fastify 를 띄우지 않는다.** 이 패키지에 fastify 를 devDependency 로 넣으면 각
 * 서비스 Dockerfile 의 `shared-build` 스테이지가 그것을 설치하는데, 그 스테이지는
 * QEMU 로 emulate 된 arm64 에서도 돌아 `pnpm install` 이 죽었다(실측). 실제
 * Fastify 와의 접합은 소비처 테스트(Planner·Builder·Manager)가 각자 검증한다.
 */
function fakeHost() {
  const routes = new Map<string, (req: unknown, reply: Reply) => Promise<unknown>>()
  const register: HealthRouteRegistrar = (path, handler) => routes.set(path, handler)
  return {
    register,
    paths: () => [...routes.keys()],
    async call(path: string) {
      const handler = routes.get(path)
      if (!handler) throw new Error(`등록되지 않은 경로: ${path}`)
      const reply = new Reply()
      const returned = await handler(undefined, reply)
      // liveness 는 본문을 그대로 반환하고, readiness 는 reply 로 코드를 정한다.
      return { code: reply.statusCode ?? 200, body: reply.payload ?? returned }
    },
  }
}

class Reply {
  statusCode?: number
  payload?: unknown
  code(statusCode: number) {
    this.statusCode = statusCode
    return { send: (payload: unknown) => { this.payload = payload; return this } }
  }
}

const call = async (opts: HealthRouteOptions, path: string) => {
  const h = fakeHost()
  registerHealthRoutes(h.register, opts)
  return h.call(path)
}

const ok: ReadinessProbe = { name: 'redis', run: async () => 'ok' }
const bad: ReadinessProbe = { name: 'loop', run: async () => 'fail' }

describe('registerHealthRoutes', () => {
  it('경로 두 개만 등록한다', () => {
    const h = fakeHost()
    registerHealthRoutes(h.register, { service: 'svc' })
    expect(h.paths()).toEqual(['/health', '/health/ready'])
  })

  it('liveness 기본 본문은 status·service 다', async () => {
    const { code, body } = await call({ service: 'svc' }, '/health')
    expect(code).toBe(200)
    expect(body).toEqual({ status: 'ok', service: 'svc' })
  })

  it('liveness 본문을 넘기면 그것을 쓴다 — 기존 계약을 지키기 위한 탈출구', async () => {
    // Manager 의 `/health` 는 `{status:'ok'}` 만 낸다. 공유 등록기로 옮기면서 본문을
    // 통일하면 그 서비스의 기존 단언이 깨진다.
    const { body } = await call({ service: 'svc', liveness: () => ({ status: 'ok' }) }, '/health')
    expect(body).toEqual({ status: 'ok' })
  })

  it('프로브가 전부 ok 면 200 ready', async () => {
    const { code, body } = await call({ service: 'svc', probes: [ok] }, '/health/ready')
    expect(code).toBe(200)
    expect(body).toMatchObject({ status: 'ready', service: 'svc' })
  })

  it('fail 이 하나라도 있으면 503 이고 검사 결과가 그대로 실린다', async () => {
    const { code, body } = await call({ service: 'svc', probes: [ok, bad] }, '/health/ready')
    expect(code).toBe(503)
    const report = body as { status: string; checks: Record<string, { status: string }> }
    expect(report.status).toBe('not_ready')
    expect(report.checks['redis']?.status).toBe('ok')
    expect(report.checks['loop']?.status).toBe('fail')
  })

  it('프로브를 주지 않으면 ready — 검사할 것이 없는 것은 장애가 아니다', async () => {
    const { code, body } = await call({ service: 'svc' }, '/health/ready')
    expect(code).toBe(200)
    expect((body as { checks: unknown }).checks).toEqual({})
  })

  it('의존이 죽어도 liveness 는 그대로다 — 둘을 섞지 않는다', async () => {
    const h = fakeHost()
    registerHealthRoutes(h.register, { service: 'svc', probes: [bad] })
    expect((await h.call('/health')).code).toBe(200)
    expect((await h.call('/health/ready')).code).toBe(503)
  })
})
