import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import type { Config } from '../config.js'
import { makeServerOptions } from '../server.js'

/**
 * **Fastify 인스턴스 옵션 계약.**
 *
 * `buildServer` 는 DB·Redis·Anthropic 배선을 통째로 끌고 오므로 저장소에 이 함수를
 * 부르는 테스트가 **하나도 없다.** 그래서 인스턴스 옵션 두 줄이 오래 틀린 채로 있었다.
 * 옵션 계산을 순수 함수로 떼어 여기서 고정한다 — 배선 없이 검사 가능한 형태다.
 */

/** 스키마 전체를 짓지 않는다. 이 함수가 읽는 두 키만 있으면 된다. */
function cfg(over: Partial<Config> = {}): Config {
  return { MODE: 'local', TRUST_PROXY: false, ...over } as Config
}

describe('makeServerOptions — 로거', () => {
  it('MODE=remote 에서 로거가 켜진다', () => {
    // 이전 판은 `logger: config.MODE === 'local'` 이었다. 즉 **프로덕션에서만 로그가 꺼졌다.**
    // 프로덕션 src 의 `app.log.*` 호출부 73곳이 전부 no-op 이 되고, 그중에는
    // setErrorHandler 의 `app.log.error({ err, url })` 도 있다 — 500 이 흔적 없이 사라진다.
    expect(makeServerOptions(cfg({ MODE: 'remote' })).logger).toBe(true)
  })

  it('MODE=local 에서도 로거가 켜진다 — dev 로그를 뺏지 않는다', () => {
    // "remote 에서 켠다"를 조건 반전으로 만족시키면 이번엔 dev 가 조용해진다.
    // 헤드리스 서비스라 양쪽 다 켜는 것이 맞다(Electron 을 안고 있는 Orchestrator 와 다르다).
    expect(makeServerOptions(cfg({ MODE: 'local' })).logger).toBe(true)
  })

  it('반환 옵션으로 만든 Fastify 는 실제 동작 로거를 갖는다', () => {
    // `logger: false` 면 Fastify 가 abstract-logging 을 끼워 `.level` 이 undefined 다.
    // 옵션 값만 보지 않고 인스턴스까지 확인한다.
    const app = Fastify(makeServerOptions(cfg({ MODE: 'remote' })))
    expect(typeof app.log.level).toBe('string')
  })
})

describe('makeServerOptions — trustProxy', () => {
  it('기본값은 false 다', () => {
    expect(makeServerOptions(cfg()).trustProxy).toBe(false)
  })

  it('TRUST_PROXY=true 면 true 다', () => {
    expect(makeServerOptions(cfg({ TRUST_PROXY: true })).trustProxy).toBe(true)
  })

  it('MODE 는 trustProxy 를 바꾸지 않는다 — 배포 형태와 프록시 유무는 별개다', () => {
    expect(makeServerOptions(cfg({ MODE: 'remote' })).trustProxy).toBe(false)
    expect(makeServerOptions(cfg({ MODE: 'local', TRUST_PROXY: true })).trustProxy).toBe(true)
  })
})

describe('trustProxy 행동 — X-Forwarded-For 채택 여부', () => {
  async function observedIp(trustProxy: boolean): Promise<string> {
    const app = Fastify({ logger: false, trustProxy })
    app.get('/ip', async (req) => ({ ip: req.ip }))
    try {
      const res = await app.inject({
        method: 'GET', url: '/ip', headers: { 'x-forwarded-for': '203.0.113.9' },
      })
      return (res.json() as { ip: string }).ip
    } finally {
      await app.close()
    }
  }

  it('trustProxy=false 면 X-Forwarded-For 를 무시한다', async () => {
    expect(await observedIp(false)).not.toBe('203.0.113.9')
  })

  it('trustProxy=true 면 X-Forwarded-For 를 클라이언트 IP 로 채택한다', async () => {
    // 프록시 뒤가 아니면 이 헤더는 클라이언트가 임의로 쓰는 값이다. Manager 는 오늘
    // rate limit 도 IP 기반 로직도 없어 **악용 경로가 아직 없지만**, 그래서 더더욱
    // 하드코딩으로 켜 둘 이유가 없다 — 뒤에 IP 기반 장치가 붙는 순간 이미 뚫린 상태다.
    expect(await observedIp(true)).toBe('203.0.113.9')
  })
})
