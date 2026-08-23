import { describe, it, expect } from 'vitest'
import type { Config } from '../config.js'
import { isLocalhostOrigin, makeCorsOriginCheck } from '../server.js'

/**
 * **CORS Origin 판정 계약.**
 *
 * 이전 판은 `MODE=local` 이면 `origin: true` 였다 — 즉 **인터넷의 어떤 페이지든**
 * 사용자의 브라우저를 통해 로컬 오케스트레이터에 교차출처 요청을 보낼 수 있었다.
 * 로컬 서버의 고전적 CSRF·DNS rebinding 표면이고, 이 서버는 세션 생성·프로젝트
 * 파일 접근 같은 mutation 을 노출한다.
 *
 * 좁히되 Electron 이 실제로 쓰는 경로는 **명시적으로** 보존해야 한다. 그 경로를
 * 여기서 하나씩 고정한다 — 좁히다가 Electron 을 깨뜨리면 다음 사람이 `origin: true`
 * 로 되돌리고, 그러면 원점이다.
 */

const LOCAL: Config = {
  port: 0,
  redisUrl: 'redis://127.0.0.1:6379',
  managerUrl: 'http://localhost:3001',
  claudeMode: 'cli',
  mode: 'local',
  auth: 'none',
  allowedOrigins: [],
  trustProxy: false,
  claudeModel: 'test',
  serveWeb: false,
}

const REMOTE: Config = {
  ...LOCAL,
  mode: 'remote',
  auth: 'jwt',
  serviceJwtSecret: 'service-secret-that-is-long-enough-32ch',
  allowedOrigins: ['https://app.example.com'],
}

/** `@fastify/cors` 의 콜백 규약을 동기적으로 풀어 판정만 꺼낸다. */
function allows(config: Config, origin: string | undefined): boolean {
  let result: boolean | undefined
  makeCorsOriginCheck(config)(origin, (err, ok) => {
    expect(err).toBeNull()
    result = ok
  })
  if (result === undefined) throw new Error('콜백이 호출되지 않았다')
  return result
}

describe('isLocalhostOrigin', () => {
  it.each([
    ['http://localhost:5173', true],
    ['http://localhost', true],
    ['https://127.0.0.1:3000', true],
    ['http://[::1]:5173', true],
    ['http://evil.com', false],
    // 접두사·접미사만 같은 호스트는 로컬호스트가 아니다 — 문자열 포함 비교의 함정.
    ['http://localhost.evil.com', false],
    ['http://notlocalhost', false],
    ['http://127.0.0.1.evil.com', false],
    // URL 로 파싱되지 않거나 http(s) 가 아닌 스킴은 로컬호스트로 치지 않는다.
    ['file://localhost/etc/passwd', false],
    ['null', false],
    ['', false],
    ['not a url', false],
  ])('%s → %s', (origin, expected) => {
    expect(isLocalhostOrigin(origin)).toBe(expected)
  })
})

describe('makeCorsOriginCheck — 로컬 모드 (Electron 경로 보존)', () => {
  it('Origin 헤더가 없으면 허용한다 — CORS 요청이 아니다', () => {
    // Electron 프로덕션 렌더러(`file://`)와 서버 간 호출이 여기 해당한다.
    expect(allows(LOCAL, undefined)).toBe(true)
  })

  it('문자열 "null" Origin 을 허용한다 — file:// 문서가 보내는 값', () => {
    expect(allows(LOCAL, 'null')).toBe(true)
  })

  it('로컬호스트를 포트 무관 허용한다 — vite dev 포트가 바뀌어도 동작', () => {
    expect(allows(LOCAL, 'http://localhost:5173')).toBe(true)
    expect(allows(LOCAL, 'http://localhost:4173')).toBe(true)
    expect(allows(LOCAL, 'http://127.0.0.1:5173')).toBe(true)
  })

  it('임의의 외부 Origin 은 로컬 모드에서도 거부한다', () => {
    // 이것이 이전 판(`origin: true`)에서 열려 있던 구멍이다.
    expect(allows(LOCAL, 'https://evil.com')).toBe(false)
    expect(allows(LOCAL, 'http://localhost.evil.com')).toBe(false)
  })

  it('ALLOWED_ORIGINS 는 로컬 모드에서도 추가 허용한다', () => {
    expect(allows({ ...LOCAL, allowedOrigins: ['https://staging.example.com'] },
      'https://staging.example.com')).toBe(true)
  })
})

describe('makeCorsOriginCheck — 원격 모드 (allowlist 전용)', () => {
  it('allowlist 에 있는 Origin 만 허용한다', () => {
    expect(allows(REMOTE, 'https://app.example.com')).toBe(true)
    expect(allows(REMOTE, 'https://other.example.com')).toBe(false)
  })

  it('원격 모드에서는 로컬호스트도 자동 허용하지 않는다', () => {
    // 원격 배포에 로컬호스트 예외를 남기면 개발자 기기의 페이지가 프로덕션을 호출한다.
    expect(allows(REMOTE, 'http://localhost:5173')).toBe(false)
    expect(allows(REMOTE, 'null')).toBe(false)
  })

  it('Origin 헤더 부재는 원격에서도 허용한다 — 서버 간 호출을 막지 않는다', () => {
    expect(allows(REMOTE, undefined)).toBe(true)
  })

  it('정확 일치만 허용한다 — 하위 도메인·경로 접미사는 통과하지 않는다', () => {
    expect(allows(REMOTE, 'https://app.example.com.evil.com')).toBe(false)
    expect(allows(REMOTE, 'https://evil.app.example.com')).toBe(false)
    expect(allows(REMOTE, 'https://app.example.com:8443')).toBe(false)
  })
})
