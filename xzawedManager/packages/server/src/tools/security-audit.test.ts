import { describe, it, expect } from 'vitest'
import { outputSchema } from './security-audit.js'

/**
 * **Security 감사 결과 계약의 체인 테스트.**
 *
 * 이 계약은 네 곳에 독립 선언돼 있고 tsc가 교차검증하지 못한다.
 *
 *   1. `xzawedSecurity/src/types.ts`                      수기 TS interface(생산자)
 *   2. `tools/security-audit.ts` 미러 interface
 *   3. `tools/security-audit.ts` outputSchema             ← z.object 기본 strip
 *   4. `streams/verify.ts` SecurityResultSchema           ← 2단 strip
 *
 * 3번을 빠뜨리면 Security가 보낸 필드가 **런타임에 조용히 사라진다.** 그 상태로도 tsc는
 * 통과하고 테스트도 초록이라, 여기서 실제 Zod를 통과시켜 고정한다. 이 파일이 생기기
 * 전에는 미러를 실제로 파싱하는 테스트가 저장소에 하나도 없었다.
 */

/** Security 가 실제로 발행하는 형태(생산자 strict). */
const fullPayload = {
  issues: [
    { id: 'S003-1', severity: 'high', source: 'static', category: 'injection',
      file: 'src/a.ts', line: 1, description: 'eval', suggestion: '제거' },
  ],
  score: 85,
  summary: '총 1개 이슈',
  content: '총 1개 이슈',
  auditable: {
    static: { requested: 3, scanned: 3, skippedByReason: { path: 0, stat: 0, oversize: 0, read: 0, analyzerError: 0 } },
    deps: { status: 'ok', tool: 'npm' },
  },
}

describe('outputSchema — auditable 이 strip되지 않는다', () => {
  it('감사 가능 비트를 보존한다', () => {
    const out = outputSchema.parse(fullPayload)
    expect(out.auditable?.static?.scanned).toBe(3)
    expect(out.auditable?.deps?.status).toBe('ok')
  })

  it('skippedByReason 의 모든 사유를 보존한다', () => {
    const out = outputSchema.parse({
      ...fullPayload,
      auditable: {
        static: { requested: 5, scanned: 1, skippedByReason: { path: 2, stat: 1, oversize: 1, read: 0, analyzerError: 0 } },
        deps: { status: 'unavailable', tool: 'npm', reason: 'npm_exec' },
      },
    })
    expect(out.auditable?.static?.skippedByReason).toEqual({ path: 2, stat: 1, oversize: 1, read: 0, analyzerError: 0 })
    expect(out.auditable?.deps?.reason).toBe('npm_exec')
  })

  it('deps.tool 은 null 을 허용한다 — 도구를 못 찾은 상태를 표현한다', () => {
    const out = outputSchema.parse({
      ...fullPayload,
      auditable: { deps: { status: 'unavailable', tool: null, reason: 'npm_not_found' } },
    })
    expect(out.auditable?.deps?.tool).toBeNull()
  })

  it('세 status 값을 전부 받는다', () => {
    for (const status of ['ok', 'unavailable', 'not_applicable'] as const) {
      const out = outputSchema.parse({ ...fullPayload, auditable: { deps: { status } } })
      expect(out.auditable?.deps?.status).toBe(status)
    }
  })
})

describe('outputSchema — 소비자 lenient', () => {
  it('auditable 이 아예 없어도 통과한다 — 구버전 Security 호환', () => {
    const { auditable: _drop, ...withoutAuditable } = fullPayload
    void _drop
    const out = outputSchema.parse(withoutAuditable)
    expect(out.auditable).toBeUndefined()
    expect(out.issues).toHaveLength(1)
  })

  it('auditable 의 내부 키가 부분적으로만 와도 통과한다', () => {
    const out = outputSchema.parse({ ...fullPayload, auditable: { static: { scanned: 2 } } })
    expect(out.auditable?.static?.scanned).toBe(2)
    expect(out.auditable?.static?.requested).toBeUndefined()
  })

  it('미지 status 값은 거부한다 — 오타가 조용히 통과하지 않는다', () => {
    expect(() => outputSchema.parse({
      ...fullPayload,
      auditable: { deps: { status: 'okay' } },
    })).toThrow()
  })
})

describe('outputSchema — 기존 필드 회귀', () => {
  it('payload 가 비어도 기본값으로 채운다', () => {
    const out = outputSchema.parse({})
    expect(out.issues).toEqual([])
    expect(out.score).toBe(100)
  })

  it('issue 의 source 세 값을 받는다', () => {
    for (const source of ['static', 'deps', 'llm'] as const) {
      const out = outputSchema.parse({
        issues: [{ id: 'x', severity: 'low', source, category: 'c', file: 'f', description: 'd', suggestion: 's' }],
      })
      expect(out.issues[0]?.source).toBe(source)
    }
  })
})
