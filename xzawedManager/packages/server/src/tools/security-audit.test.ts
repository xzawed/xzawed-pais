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
  // ⚠️ 여기 있던 `payload 가 비어도 기본값으로 채운다` 는 **결함 D2 를 고정하던 테스트**다.
  // 빈 payload 를 `0건·100점` 으로 합성하는 것이 정확히 "감사 불능이 만점으로 보고되는" 경로였다
  // (L1-5). S5.1 에서 뒤집었고, 대체 단언은 위 `합성하지 않는다` describe 에 있다.

  it('issue 의 source 세 값을 받는다', () => {
    for (const source of ['static', 'deps', 'llm'] as const) {
      const out = outputSchema.parse({
        score: 100,
        issues: [{ id: 'x', severity: 'low', source, category: 'c', file: 'f', description: 'd', suggestion: 's' }],
      })
      expect(out.issues[0]?.source).toBe(source)
    }
  })
})

/**
 * **합성 금지**(S5.1 / 결함 D2). `issues.default([])` · `score.default(100)` 은
 * Security 가 침묵해도 **"0건·100점"을 만들어 낸다** — 챗 도구가 광고한 대로 감사했다는
 * 증거 없이 만점을 보고하던 자리다. 기본 경로(대화형 챗)의 약속 위반이라 verify 채널보다 먼저다.
 *
 * 생산자(`xzawedSecurity/src/security.ts:120-124`)는 `issues`·`score`·`summary`·`auditable` 을
 * **항상** 싣는다. 필수화해도 정상 경로 회귀가 0인 이유다.
 */
describe('outputSchema — 침묵을 만점으로 합성하지 않는다(S5.1)', () => {
  const base = {
    issues: [], score: 100, summary: 's', content: 'c',
    auditable: { static: { requested: 1, scanned: 1 }, deps: { status: 'ok' } },
  }

  it('완전한 payload 는 그대로 통과한다(회귀 0)', () => {
    expect(outputSchema.parse(base)).toMatchObject({ issues: [], score: 100 })
  })

  it.each(['issues', 'score'])('%s 가 없으면 파싱에 실패한다(합성 금지)', (field) => {
    const { [field]: _drop, ...partial } = base as Record<string, unknown>
    expect(outputSchema.safeParse(partial).success, `${field} 부재가 통과했다`).toBe(false)
  })

  it('빈 payload 를 0건·100점으로 만들어 내지 않는다', () => {
    expect(outputSchema.safeParse({}).success).toBe(false)
  })

  it('auditable 부재는 여전히 통과시킨다 — 관용은 전선 수준이고 판정은 judgeAuditable 이 한다', () => {
    const { auditable: _d, ...noAuditable } = base as Record<string, unknown>
    expect(outputSchema.safeParse(noAuditable).success).toBe(true)
  })
})
