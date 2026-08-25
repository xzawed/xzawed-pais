import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { judgePrimaryResult, verifyWp, type VerifyDeps } from './verify.js'
import { designUiOutputSchema } from '../tools/design-ui.js'

/**
 * **`design_ui` WP 자기검증**(S5.2b / 결함 F4 · 수용 기준 L2-3).
 *
 * `security_audit`(S5.2a)과 같은 이유로 pass-through 였고 파생 플랜도 비어 **증거 0회로 즉시
 * 통과**했다. 그런데 이쪽은 판정 재료를 만드는 것부터가 슬라이스였다.
 *
 * **컴포넌트 수는 증거가 될 수 없다.** Designer 의 파싱 실패 폴백이 generic 스텁 컴포넌트
 * **1개**를 그대로 `design_complete` 로 발행하므로 `components.length > 0` 은 프로덕션에서
 * 항상 참이다 — 그 술어로 게이트를 열면 LLM 응답을 한 글자도 못 읽은 실행이 통과한다.
 * 그래서 생산자가 출처(`designed.source`)를 밝히게 했다(`auditable` 비트와 같은 해법).
 */

const DESIGNED = { source: 'llm' as const, components: 1 }
const COMPONENTS = [{ name: 'LoginForm', description: 'login', props: { onSubmit: '() => void' } }]

const wp = {
  id: 'wp-design', storyId: 's1', owningRole: 'designer',
  acceptanceCriteria: ['AC1'], risk: 'MEDIUM',
} as unknown as WorkPackage

function deps(over: Partial<VerifyDeps> = {}): VerifyDeps {
  return {
    handlers: {}, buildInput: () => ({ context: {}, severity: 'low', projectPath: '/abs/ws', artifacts: [] }),
    workflowId: 'wf-1', attempt: 0,
    userContext: { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } as never,
    ...over,
  }
}

describe('judgePrimaryResult(design_ui) — 증거 없이 통과하지 않는다', () => {
  test('LLM 이 실제로 설계했으면 통과한다', () => {
    expect(judgePrimaryResult('design_ui', { components: COMPONENTS, designed: DESIGNED })).toEqual({ ok: true })
  })

  test('결과 파싱에 실패하면 통과하지 않는다', () => {
    expect(judgePrimaryResult('design_ui', { nope: 1 }).ok).toBe(false)
  })

  test('designed 집계가 없으면 통과하지 않는다(부재를 통과로 읽지 않는다)', () => {
    const v = judgePrimaryResult('design_ui', { components: COMPONENTS })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/집계 부재/)
  })

  test('폴백 스텁은 통과하지 않는다 — 무음 통과가 막히는 자리', () => {
    const v = judgePrimaryResult('design_ui', {
      components: [{ name: 'Component', description: 'login form', props: { children: 'React.ReactNode' } }],
      designed: { source: 'fallback', components: 1 },
    })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/폴백/)
  })

  test('컴포넌트 0개는 설계 산출물이 아니다', () => {
    expect(judgePrimaryResult('design_ui', { components: [], designed: { source: 'llm', components: 0 } }).ok).toBe(false)
  })

  test('집계와 배열이 어긋나면 전선 유실로 보고 통과시키지 않는다', () => {
    const v = judgePrimaryResult('design_ui', { components: COMPONENTS, designed: { source: 'llm', components: 3 } })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/전선 유실/)
  })

  test('미지 source 값은 파싱에서 거부된다(느슨하게 열지 않는다)', () => {
    expect(judgePrimaryResult('design_ui', { components: COMPONENTS, designed: { source: 'guess', components: 1 } }).ok).toBe(false)
  })

  test('컴포넌트가 여럿이어도 집계가 맞으면 통과한다', () => {
    const many = [
      { name: 'A', description: 'a', props: {} },
      { name: 'B', description: 'b', props: {} },
    ]
    expect(judgePrimaryResult('design_ui', { components: many, designed: { source: 'llm', components: 2 } })).toEqual({ ok: true })
  })
})

describe('verifyWp(design_ui) — 증거를 남긴다', () => {
  test('통과 시 design 채널 증거를 기록한다(게이트가 볼 수 있어야 한다)', async () => {
    const recordOutcome = vi.fn()
    const v = await verifyWp('design_ui', wp, { components: COMPONENTS, designed: DESIGNED }, deps({ recordOutcome }))
    expect(v.ok).toBe(true)
    expect(recordOutcome).toHaveBeenCalledWith('design', 'passed')
  })

  test('폴백이면 증거를 남기지 않는다', async () => {
    const recordOutcome = vi.fn()
    const v = await verifyWp('design_ui', wp, {
      components: COMPONENTS, designed: { source: 'fallback', components: 1 },
    }, deps({ recordOutcome }))
    expect(v.ok).toBe(false)
    expect(recordOutcome).not.toHaveBeenCalled()
  })

  test('다른 도구의 증거 기록에는 영향이 없다(회귀 0)', async () => {
    const recordOutcome = vi.fn()
    await verifyWp('run_tests', wp, { success: true, passed: 3, failed: 0 }, deps({ recordOutcome }))
    expect(recordOutcome).toHaveBeenCalledWith('tc', 'passed')
    expect(recordOutcome).not.toHaveBeenCalledWith('design', 'passed')
  })
})

/**
 * **프로덕션이 실제로 내는 모양으로 건다 — 2단 strip 을 실제로 통과시킨다.**
 *
 * 이 저장소는 Zod strip 으로 필드가 조용히 사라지는 사고를 반복했다(S5.1 의
 * `SecurityResultSchema` 주석이 같은 것을 경고한다). 판정 함수만 단독으로 테스트하면
 * **`tools/design-ui.ts` 에서 `designed` 가 strip 돼도 초록**이라 아무 소용이 없다.
 *
 * 그래서 여기서는 Designer 가 전선에 싣는 payload 를 **Manager 의 실제 outputSchema 로 파싱한 뒤**
 * 그 결과를 판정에 넣는다. 어느 한쪽에서 필드가 빠지면 이 describe 가 깨진다.
 */
describe('design_ui 전선 왕복 — Manager outputSchema 를 실제로 통과시킨다', () => {
  /** `xzawedDesigner/src/designer.ts` 가 `design_complete` 로 발행하는 payload 그대로. */
  const wirePayloadOk = {
    components: COMPONENTS,
    uiSpec: { type: 'mockup_viewer', title: 'Login', content: '## Login\n- email\n- password' },
    designed: { source: 'llm', components: 1 },
    content: 'Generated 1 component(s) for: login form',
  }

  /** 같은 위치에서 파싱 실패 폴백이 발행하는 payload 그대로(`claude/runner.ts` fallback). */
  const wirePayloadFallback = {
    components: [{ name: 'Component', description: 'login form', props: { children: 'React.ReactNode' } }],
    uiSpec: { type: 'mockup_viewer', title: 'login form', content: 'login form' },
    designed: { source: 'fallback', components: 1 },
    content: 'Generated 1 component(s) for: login form',
  }

  test('성공 payload 는 스키마를 통과하고 designed 가 살아남는다', () => {
    const parsed = designUiOutputSchema.parse(wirePayloadOk)
    expect(parsed.designed, 'designed 가 strip 됐다').toEqual({ source: 'llm', components: 1 })
    expect(judgePrimaryResult('design_ui', parsed)).toEqual({ ok: true })
  })

  test('폴백 payload 는 스키마를 통과하지만 판정에서 막힌다', () => {
    const parsed = designUiOutputSchema.parse(wirePayloadFallback)
    expect(parsed.designed).toEqual({ source: 'fallback', components: 1 })
    expect(judgePrimaryResult('design_ui', parsed).ok).toBe(false)
  })

  /**
   * **교차질의 답변 경로 회귀 잠금 — 이 슬라이스가 실제로 한 번 깬 자리다.**
   *
   * `design_complete` 발행자는 **둘**이다. `designer.ts` 의 `runMain` 말고, shared
   * `publishQueryAnswer`(`collaboration.ts`)가 다른 에이전트의 질의에 답할 때
   * **`payload: { content }` 만** 발행한다. 그리고 그 경로는 **플래그 뒤가 아니라 기본 실행되는
   * 챗 경로**다(AgentQuery 교차질의 라우팅).
   *
   * S5.2b 초안은 "합성 기본값 제거"를 하면서 `components`·`uiSpec` 의 `.default()` 를 걷어냈고,
   * 그 순간 이 payload 가 `RedisAgentHandler` 의 `outputSchema.parse` 에서 throw 하게 됐다.
   * **유닛 스위트는 전부 초록이었다** — 그 경로를 파싱까지 태우는 테스트가 없었기 때문이다.
   * 이 describe 가 그 구멍이다.
   */
  test('교차질의 답변({content} 뿐)은 스키마를 통과해야 한다 — 기본 실행 경로다', () => {
    const parsed = designUiOutputSchema.parse({ content: '가능합니다, 5초 폴링 권장' })
    expect(parsed.content).toBe('가능합니다, 5초 폴링 권장')
    expect(parsed.components).toEqual([])
    expect(parsed.uiSpec).toEqual({ type: 'mockup_viewer' })
  })

  /**
   * 기본값을 남겨도 **증거를 위조하지 않는다** — 증거는 `designed` 집계이지 `components` 가
   * 아니기 때문이다. 위조 가능한 자리를 없앤 것은 증거를 다른 필드로 옮겨서이지 기본값을 지워서가 아니다.
   */
  test('기본값으로 만들어진 빈 설계는 판정에서 막힌다(위조가 통과로 이어지지 않는다)', () => {
    const parsed = designUiOutputSchema.parse({ content: '가능합니다' })
    expect(judgePrimaryResult('design_ui', parsed).ok).toBe(false)
  })

  test('designed 없는 구버전 payload 는 스키마는 통과하되 판정에서 막힌다(fail-closed)', () => {
    const parsed = designUiOutputSchema.parse({
      components: COMPONENTS,
      uiSpec: { type: 'mockup_viewer' },
      content: 'x',
    })
    expect(parsed.designed).toBeUndefined()
    expect(judgePrimaryResult('design_ui', parsed).ok).toBe(false)
  })
})
